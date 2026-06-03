import pandas as pd
import numpy as np
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.holtwinters import SimpleExpSmoothing
import psycopg2
import pickle
import os
import json
import warnings
warnings.filterwarnings("ignore")

MODELS_DIR  = '/opt/net-model/models'
TRAIN_SIZE  = 100
DB_CONN     = dict(host="localhost", dbname="edgedb", user="netsec", password="Netsec123")
SC_FEATURES = ['cpu_5s', 'mem_used', 'in_bps', 'out_bps', 'in_err_rate']

FEATURES = {
    'in_err_rate': 'Interface Errors',
    'cpu_5s'     : 'CPU (%)',
    'mem_used'   : 'Memory Used (MB)',
    'in_bps'     : 'Traffic In (bps)',
    'out_bps'    : 'Traffic Out (bps)',
}

threshold_path = f'{MODELS_DIR}/arima_thresholds.json'
try:
    with open(threshold_path) as f:
        global_thresholds = json.load(f)
except FileNotFoundError:
    print(f"ERROR: ไม่พบ {threshold_path} — รัน train_arima_threshold.py ก่อน")
    raise SystemExit(1)

_sc_path = f'{MODELS_DIR}/scenario_classifier.pkl'
if os.path.exists(_sc_path):
    with open(_sc_path, 'rb') as f:
        _scenario_clf = pickle.load(f)
    print("โหลด scenario_classifier.pkl สำเร็จ")
else:
    _scenario_clf = None
    print("WARNING: ไม่พบ scenario_classifier.pkl — รัน train_scenario_classifier.py ก่อน")

CONFIDENCE_THRESHOLD = 0.60
LOG_FEATURES = {'in_bps', 'out_bps'}
SES_FEATURES = {'in_bps', 'out_bps'}   # SimpleExpSmoothing แทน ARIMA สำหรับ traffic

LABEL_RULES = {
    'high_cpu'   : lambda X: X['cpu_5s']  > 80,
    'high_memory': lambda X: X['mem_used'] > 16_500_000,
}


def assign_scenario_batch(result_df):
    scenario = pd.Series([None] * len(result_df), index=result_df.index)
    mask = result_df['anomaly'] == True
    if mask.sum() == 0:
        return scenario
    if _scenario_clf is not None:
        X = result_df.loc[mask, SC_FEATURES].fillna(0)
        proba     = _scenario_clf.predict_proba(X)
        predicted = _scenario_clf.predict(X)
        predicted = np.where(proba.max(axis=1) >= CONFIDENCE_THRESHOLD, predicted, 'unknown_anomaly')
        for label, rule_fn in LABEL_RULES.items():
            violates = (predicted == label) & (~rule_fn(X).values)
            predicted = np.where(violates, 'unknown_anomaly', predicted)
        scenario.loc[mask] = predicted
    else:
        scenario.loc[mask] = 'unknown_anomaly'
    return scenario


# ─── โหลดข้อมูลจาก ml_isolation_forest ────────────────────────────────────
conn = psycopg2.connect(**DB_CONN)
df = pd.read_sql("""
    SELECT time, hostname, cpu_5s, mem_used, in_bps, out_bps, in_err_rate
    FROM ml_isolation_forest
    ORDER BY hostname, time ASC
""", conn)

# ─── หา last timestamp ที่ process ไปแล้วต่อ (hostname, feature) ───────────
last_df = pd.read_sql("""
    SELECT hostname, feature, MAX(time) AS last_time
    FROM ml_arima
    GROUP BY hostname, feature
""", conn)
conn.close()

df['time'] = pd.to_datetime(df['time'])
last_df['last_time'] = pd.to_datetime(last_df['last_time'])
last_time_map = {(r.hostname, r.feature): r.last_time for r in last_df.itertuples()}

hostnames = df['hostname'].unique().tolist()
print(f"โหลดข้อมูลจาก DB {len(df)} rows | {len(hostnames)} hostname: {hostnames}")

all_results = []

for hostname, host_df in df.groupby('hostname'):
    host_df = host_df.sort_values('time').reset_index(drop=True)
    print(f"\n{'='*55}\nhostname: {hostname} ({len(host_df)} rows total)")

    host_results = []

    for feat, feat_name in FEATURES.items():
        series = host_df[feat].values
        n      = len(series)

        # ─── Incremental: หาจุดเริ่มต้น ────────────────────────────────────
        last_t = last_time_map.get((hostname, feat))

        if last_t is not None:
            new_mask = host_df['time'] > last_t
            if not new_mask.any():
                print(f"  {feat_name}: up-to-date (last={last_t.date()})")
                continue
            first_new = int(new_mask.values.argmax())   # position แรกที่ใหม่กว่า
            ctx_start = max(0, first_new - TRAIN_SIZE)  # context ก่อนหน้า
            loop_start = first_new - ctx_start           # relative warmup end
            save_from  = loop_start                      # บันทึกตั้งแต่ row นี้
            new_count  = n - first_new
            print(f"  {feat_name}: {new_count} new rows (since {last_t.date()})")
        else:
            ctx_start  = 0
            loop_start = TRAIN_SIZE
            save_from  = TRAIN_SIZE
            new_count  = n - TRAIN_SIZE
            print(f"  {feat_name}: first run — {new_count} rows to process")

        sub = series[ctx_start:]
        sub_df = host_df.iloc[ctx_start:].reset_index(drop=True)

        if len(sub) - loop_start < 1:
            print(f"    SKIP: ข้อมูลไม่พอ")
            continue

        # ─── in_err_rate: direct check ───────────────────────────────────
        if feat == 'in_err_rate':
            for i in range(loop_start if last_t else TRAIN_SIZE, len(sub)):
                if i < save_from:
                    continue
                actual = sub[i]
                host_results.append({
                    'time'        : sub_df['time'].iloc[i],
                    'hostname'    : hostname,
                    'feature'     : feat,
                    'feature_name': feat_name,
                    'actual'      : actual,
                    'predicted'   : 0,
                    'residual'    : actual,
                    'threshold'   : 0,
                    'anomaly'     : actual > 0,
                })
            n_saved = sum(1 for r in host_results if r['feature'] == feat and r['hostname'] == hostname)
            print(f"    บันทึก {n_saved} rows")
            continue

        # ─── Hard-rule features (cpu_5s, in_bps, out_bps) ──────────────────
        if feat in ('cpu_5s', 'in_bps', 'out_bps'):
            hard_thresh = 80 if feat == 'cpu_5s' else 100_000_000
            start_i = loop_start if last_t else TRAIN_SIZE
            for i in range(start_i, len(sub)):
                if i < save_from:
                    continue
                actual = float(sub[i])
                is_anomaly = (actual >= hard_thresh)
                host_results.append({
                    'time'        : sub_df['time'].iloc[i],
                    'hostname'    : hostname,
                    'feature'     : feat,
                    'feature_name': feat_name,
                    'actual'      : actual,
                    'predicted'   : actual,
                    'residual'    : 0.0,
                    'threshold'   : hard_thresh,
                    'anomaly'     : is_anomaly,
                })
            n_saved = sum(1 for r in host_results if r['feature'] == feat and r['hostname'] == hostname)
            n_anom  = sum(1 for r in host_results if r['feature'] == feat and r['hostname'] == hostname and r['anomaly'])
            print(f"    บันทึก {n_saved} rows | anomaly {n_anom} rows")
            continue

        # ─── ARIMA / ETS features ───────────────────────────────────────
        if feat not in global_thresholds:
            print(f"    SKIP: ไม่พบ threshold")
            continue

        threshold = global_thresholds[feat]
        use_log   = feat in LOG_FEATURES
        use_ses   = feat in SES_FEATURES
        sub_model = np.log1p(sub) if use_log else sub

        for i in range(loop_start, len(sub)):
            train_start = max(0, i - TRAIN_SIZE)
            train = sub_model[train_start:i]
            if len(train) < TRAIN_SIZE:
                continue
            if i < save_from:
                continue  # warmup เท่านั้น ไม่บันทึก

            pred_model = float(train[-1])   # default fallback
            if use_ses:
                try:
                    fit = SimpleExpSmoothing(
                        train, initialization_method='estimated',
                    ).fit(optimized=True)
                    pred_model = float(fit.forecast(1)[0])
                except Exception:
                    try:
                        fit = ARIMA(train, order=(2, 1, 2)).fit()
                        pred_model = float(fit.forecast(steps=1)[0])
                    except Exception:
                        pass
            else:
                try:
                    fit = ARIMA(train, order=(2, 1, 2)).fit()
                    pred_model = float(fit.forecast(steps=1)[0])
                except Exception:
                    pass

            actual = float(sub[i])
            pred   = float(np.expm1(pred_model)) if use_log else pred_model
            if use_log:
                # residual ใน log space — robust ต่อ counter wraps และ volatility
                residual = abs(np.log1p(actual) - pred_model)
            else:
                residual = abs(actual - pred)

            # hard rules — ไม่ใช้ residual สำหรับ features เหล่านี้
            # cpu_5s: ≥80% = anomaly (10-20% หลัง OS upgrade = ปกติ)
            # in_bps/out_bps: ≥100 Mbps = anomaly (traffic flood); actual=0 = gap detection จัดการ
            if feat == 'cpu_5s':
                is_anomaly = actual >= 80
            elif feat in ('in_bps', 'out_bps'):
                is_anomaly = actual >= 100_000_000
            else:
                is_anomaly = residual > threshold

            host_results.append({
                'time'        : sub_df['time'].iloc[i],
                'hostname'    : hostname,
                'feature'     : feat,
                'feature_name': feat_name,
                'actual'      : actual,
                'predicted'   : pred,
                'residual'    : residual,
                'threshold'   : threshold,
                'anomaly'     : is_anomaly,
            })

        saved = sum(1 for r in host_results if r['feature'] == feat and r['hostname'] == hostname)
        n_anom = sum(1 for r in host_results if r['feature'] == feat and r['hostname'] == hostname and r['anomaly'])
        print(f"    บันทึก {saved} rows | anomaly {n_anom} rows")

    if not host_results:
        print(f"  ไม่มี row ใหม่สำหรับ {hostname}")
        continue

    host_df_result = pd.DataFrame(host_results)
    feat_cols = host_df[['time', 'hostname'] + SC_FEATURES].drop_duplicates(subset=['time', 'hostname'])
    host_df_result = host_df_result.merge(feat_cols, on=['time', 'hostname'], how='left')
    host_df_result['scenario_name'] = assign_scenario_batch(host_df_result)
    all_results.append(host_df_result)
    print(f"  รวม {len(host_df_result)} new rows สำหรับ {hostname}")

# ─── Gap Detection (Device Offline) ─────────────────────────────────────────
GAP_MULTIPLIER  = 3      # gap > 3x normal interval → anomaly
GAP_MIN_SECONDS = 600    # อย่างน้อย 10 นาที

conn2 = psycopg2.connect(**DB_CONN)
last_gap_df = pd.read_sql("""
    SELECT hostname, MAX(time) AS last_gap_time
    FROM ml_arima WHERE feature = 'gap'
    GROUP BY hostname
""", conn2)
conn2.close()
last_gap_map = {r.hostname: pd.Timestamp(r.last_gap_time) for r in last_gap_df.itertuples()}

gap_records = []
print(f"\n{'='*55}\nGap Detection")

for hostname, host_df in df.groupby('hostname'):
    host_df = host_df.sort_values('time').reset_index(drop=True)
    times   = host_df['time']   # pd.Series of Timestamps

    if len(times) < 2:
        continue

    intervals_sec = times.diff().dt.total_seconds().dropna().values

    # normal interval = median ของ intervals ≤ 1 ชั่วโมง (กรอง big gaps ออก)
    short           = intervals_sec[intervals_sec <= 3600]
    normal_interval = float(np.median(short)) if len(short) > 0 else 300.0
    gap_threshold   = max(normal_interval * GAP_MULTIPLIER, float(GAP_MIN_SECONDS))

    last_gap_t = last_gap_map.get(hostname)
    new_gaps   = 0

    for i in range(len(times) - 1):
        t_start = times.iloc[i]
        t_end   = times.iloc[i + 1]
        gap_sec = float((t_end - t_start).total_seconds())

        if gap_sec <= gap_threshold:
            continue
        if last_gap_t is not None and t_start <= last_gap_t:
            continue

        # ดึง SC_FEATURES จาก row ณ t_start (ค่าล่าสุดก่อน gap)
        row_vals = host_df.iloc[i]
        gap_records.append({
            'time'        : t_start,
            'hostname'    : hostname,
            'feature'     : 'gap',
            'feature_name': 'Device Offline Gap',
            'actual'      : gap_sec,
            'predicted'   : normal_interval,
            'residual'    : gap_sec - normal_interval,
            'threshold'   : gap_threshold,
            'anomaly'     : True,
            'scenario_name': 'device_down',
            'cpu_5s'      : row_vals['cpu_5s'],
            'mem_used'    : row_vals['mem_used'],
            'in_bps'      : row_vals['in_bps'],
            'out_bps'     : row_vals['out_bps'],
            'in_err_rate' : row_vals['in_err_rate'],
        })
        gap_duration_h = gap_sec / 3600
        print(f"    GAP: {t_start} → {t_end}  ({gap_duration_h:.1f}h)")
        new_gaps += 1

    print(f"  {hostname}: normal={normal_interval:.0f}s  threshold={gap_threshold:.0f}s  new_gaps={new_gaps}")

if gap_records:
    gap_df = pd.DataFrame(gap_records)
    all_results.append(gap_df)
    print(f"  รวม gap records ใหม่ {len(gap_records)} rows")
else:
    print("  ไม่พบ gap ใหม่")

if not all_results:
    print("ไม่มีข้อมูลใหม่ทุก hostname — ไม่มีอะไรต้อง upsert")
    raise SystemExit(0)

result_df = pd.concat(all_results, ignore_index=True)
result_df.to_csv('/opt/net-model/result_arima.csv', index=False)
print(f"\nบันทึกผลที่ result_arima.csv ({len(result_df)} rows)")
print(f"Hostnames: {result_df['hostname'].unique().tolist()}")
n_gaps = (result_df['feature'] == 'gap').sum()
if n_gaps:
    print(f"Gap records: {n_gaps} rows (device_down)")

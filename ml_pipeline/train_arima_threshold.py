import pandas as pd
import numpy as np
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.holtwinters import SimpleExpSmoothing
import psycopg2
import json
import os
import warnings
warnings.filterwarnings("ignore")

MODELS_DIR     = '/opt/net-model/models'
BASELINE_START = '2026-04-10'
BASELINE_END   = '2026-04-25'
TRAIN_SIZE     = 100
# sample ทุก STEP จุดเพื่อลดเวลา calibration (percentile ยังแม่นพอ)
STEP           = 5
DB_CONN        = dict(host="localhost", dbname="edgedb", user="netsec", password="Netsec123")

# features เหล่านี้ใช้ hard rule ใน predict_arima.py — ไม่ต้อง train threshold
# cpu_5s: actual >= 80%  |  in_bps/out_bps: actual >= 100 Mbps
SKIP_THRESHOLD_FEATURES = {'cpu_5s', 'in_bps', 'out_bps'}

FEATURES = {
    'cpu_5s'  : 'CPU (%)',
    'mem_used': 'Memory Used (MB)',
    'in_bps'  : 'Traffic In (bps)',
    'out_bps' : 'Traffic Out (bps)',
}

# traffic features: ใช้ SimpleExpSmoothing + residual ใน log space
LOG_FEATURES = {'in_bps', 'out_bps'}
SES_FEATURES = {'in_bps', 'out_bps'}

os.makedirs(MODELS_DIR, exist_ok=True)

conn = psycopg2.connect(**DB_CONN)
df = pd.read_sql(f"""
    SELECT time, hostname, cpu_5s, mem_used, in_bps, out_bps
    FROM ml_isolation_forest
    WHERE time >= '{BASELINE_START}' AND time <= '{BASELINE_END}'
      AND in_bps < 1e8
    ORDER BY hostname, time ASC
""", conn)
conn.close()

df['time'] = pd.to_datetime(df['time'])
print(f"Baseline rows: {len(df)} | hostnames: {df['hostname'].unique().tolist()}")


def predict_one(train: np.ndarray, feat: str) -> float:
    """คืนค่า forecast 1 step ถัดไปใน model space (log space สำหรับ LOG_FEATURES)"""
    if feat in SES_FEATURES:
        try:
            fit = SimpleExpSmoothing(
                train, initialization_method='estimated',
            ).fit(optimized=True)
            return float(fit.forecast(1)[0])
        except Exception:
            pass  # fallback → ARIMA
    try:
        fit = ARIMA(train, order=(2, 1, 2)).fit()
        return float(fit.forecast(steps=1)[0])
    except Exception:
        return float(train[-1])


thresholds = {}

for feat, feat_name in FEATURES.items():
    if feat in SKIP_THRESHOLD_FEATURES:
        print(f"SKIP {feat_name}: ใช้ hard rule ใน predict_arima.py — ไม่ต้อง train threshold")
        continue
    use_log = feat in LOG_FEATURES

    all_residuals = []
    for hostname, host_df in df.groupby('hostname'):
        series = host_df[feat].values
        if len(series) < TRAIN_SIZE + 5:
            print(f"  SKIP {hostname}/{feat_name}: baseline น้อยเกินไป ({len(series)} rows)")
            continue

        series_model = np.log1p(series) if use_log else series

        for i in range(TRAIN_SIZE, len(series_model), STEP):
            train = series_model[i - TRAIN_SIZE:i]
            pred_model = predict_one(train, feat)
            if use_log:
                # residual ใน log space — robust ต่อ counter wraps และ volatility
                actual_log = np.log1p(series[i])
                all_residuals.append(abs(actual_log - pred_model))
            else:
                all_residuals.append(abs(series[i] - pred_model))

    if not all_residuals:
        print(f"SKIP {feat_name}: ไม่มีข้อมูลพอ")
        continue

    res_arr   = np.array(all_residuals)
    # ใช้ 97th percentile แทน mean+2std เพื่อทนทานต่อ outlier
    threshold = float(np.percentile(res_arr, 97))
    floor = FEATURE_THRESHOLD_FLOOR.get(feat)
    if floor is not None and threshold < floor:
        print(f"    threshold p97={threshold:.4f} < floor={floor} — ใช้ floor แทน (OS upgrade baseline shift)")
        threshold = floor
    thresholds[feat] = threshold
    model_tag = 'SES(log)' if feat in SES_FEATURES else 'ARIMA'
    print(f"OK  {feat_name} [{model_tag}]: threshold={threshold:.6f} (p97 of {len(res_arr)} residuals)")

out_path = f'{MODELS_DIR}/arima_thresholds.json'
with open(out_path, 'w') as f:
    json.dump(thresholds, f, indent=2)

print(f"\nThresholds saved to {out_path}")
print(json.dumps(thresholds, indent=2))

import pandas as pd
import numpy as np
import pickle
import os
import warnings
warnings.filterwarnings("ignore")

MODELS_DIR    = '/opt/net-model/models'
INFERENCE_CSV = '/opt/net-model/edge_data.csv'
SC_FEATURES   = ['cpu_5s', 'mem_used', 'in_bps', 'out_bps', 'in_err_rate']

FEATURES = ['cpu_5s', 'mem_used', 'in_bps', 'out_bps',
            'in_err_rate', 'max_severity_code',
            'count_critical', 'count_warning']

_sc_path = f'{MODELS_DIR}/scenario_classifier.pkl'
if os.path.exists(_sc_path):
    with open(_sc_path, 'rb') as f:
        _scenario_clf = pickle.load(f)
    print("โหลด scenario_classifier.pkl สำเร็จ")
else:
    _scenario_clf = None
    print("WARNING: ไม่พบ scenario_classifier.pkl — รัน train_scenario_classifier.py ก่อน")


CONFIDENCE_THRESHOLD = 0.60

# hard rule: label จะถูก override เป็น unknown_anomaly ถ้าค่าจริงไม่เกิน threshold
LABEL_RULES = {
    'high_cpu'    : lambda X: X['cpu_5s']      > 80,
    'high_memory' : lambda X: X['mem_used']    > 16_000_000,
    'elevated_cpu': lambda X: X['cpu_5s']      >= 10,
    'traffic_spike': lambda X: X['in_bps']     >= 500_000,
    'error_flood' : lambda X: X['in_err_rate'] > 50,
}

def assign_scenario_batch(df):
    result = pd.Series([None] * len(df), index=df.index)
    mask = df['anomaly_label'] == 'anomaly'
    if mask.sum() == 0:
        return result
    if _scenario_clf is not None:
        X = df.loc[mask, SC_FEATURES].fillna(0)
        proba     = _scenario_clf.predict_proba(X)
        predicted = _scenario_clf.predict(X)
        # กรอง confidence ต่ำออกก่อน
        predicted = np.where(proba.max(axis=1) >= CONFIDENCE_THRESHOLD, predicted, 'unknown_anomaly')
        # hard rule validation
        for label, rule_fn in LABEL_RULES.items():
            violates = (predicted == label) & (~rule_fn(X).values)
            predicted = np.where(violates, 'unknown_anomaly', predicted)
        result.loc[mask] = predicted
    else:
        result.loc[mask] = 'unknown_anomaly'
    return result


df = pd.read_csv(INFERENCE_CSV)
df['time'] = pd.to_datetime(df['time'])
df = df.sort_values(['hostname', 'time']).reset_index(drop=True)

results = []

for sw_name, sw_df in df.groupby('hostname'):
    safe = sw_name.replace('.', '_').replace('/', '_')
    model_path  = f'{MODELS_DIR}/{safe}_iso_model.pkl'
    scaler_path = f'{MODELS_DIR}/{safe}_iso_scaler.pkl'

    if not os.path.exists(model_path):
        print(f"SKIP {sw_name}: ไม่พบ model (รัน train_save.py ก่อน)")
        continue

    sw_df = sw_df.copy().reset_index(drop=True)
    sw_df['in_bps']      = sw_df['total_in_octets'].diff().clip(lower=0)
    sw_df['out_bps']     = sw_df['total_out_octets'].diff().clip(lower=0)
    sw_df['in_err_rate'] = sw_df['total_in_errors'].diff().clip(lower=0)
    for col in ['max_severity_code', 'count_critical', 'count_warning']:
        sw_df[col] = sw_df[col].fillna(0)
    sw_df = sw_df.dropna(subset=['in_bps', 'out_bps', 'in_err_rate'])

    # คำนวณ utilization % จาก max physical interface speed (ifType=6)
    POLL_SEC = 300
    if 'max_phy_speed_mbps' in sw_df.columns:
        speed_mbps = sw_df['max_phy_speed_mbps'].fillna(0)
        capacity_bytes = speed_mbps * 1_000_000 / 8 * POLL_SEC
        sw_df['in_util_pct'] = (sw_df['in_bps'] / capacity_bytes.replace(0, float('nan')) * 100).fillna(0).clip(upper=100)
    else:
        sw_df['in_util_pct'] = 0.0

    if sw_df.empty:
        continue

    with open(model_path, 'rb') as f:
        model = pickle.load(f)
    with open(scaler_path, 'rb') as f:
        scaler = pickle.load(f)

    X = sw_df[FEATURES]
    X_scaled = scaler.transform(X)          # transform เท่านั้น ไม่ fit ใหม่
    sw_df['anomaly'] = model.predict(X_scaled)  # predict เท่านั้น ไม่ train ใหม่
    sw_df['anomaly_label'] = sw_df['anomaly'].map({1: 'normal', -1: 'anomaly'})
    sw_df['scenario_name'] = assign_scenario_batch(sw_df)

    # refine traffic scenarios โดยใช้ in_util_pct
    if 'in_util_pct' in sw_df.columns:
        traffic_mask = sw_df['scenario_name'].isin(['traffic_flood', 'traffic_spike'])
        cong_mask  = traffic_mask & (sw_df['in_util_pct'] >= 70)
        thigh_mask = traffic_mask & ~cong_mask & (sw_df['in_util_pct'] >= 10) & (sw_df['in_err_rate'] <= 50)
        sw_df.loc[cong_mask,  'scenario_name'] = 'link_congestion'
        sw_df.loc[thigh_mask, 'scenario_name'] = 'traffic_high'

    # noise filter: anomaly ที่ทุก metric ต่ำมากและไม่มี error → จัดเป็น normal
    noise_mask = (
        (sw_df['anomaly_label'] == 'anomaly') &
        (sw_df['cpu_5s']      < 10) &
        (sw_df['mem_used']    < 10_000_000) &
        (sw_df['in_bps']      < 1_000_000) &
        (sw_df['in_err_rate'] == 0)
    )
    sw_df.loc[noise_mask, 'anomaly_label'] = 'normal'
    sw_df.loc[noise_mask, 'scenario_name'] = None

    normal  = (sw_df['anomaly_label'] == 'normal').sum()
    anomaly = (sw_df['anomaly_label'] == 'anomaly').sum()
    noise   = noise_mask.sum()
    print(f"OK  {sw_name}: Normal={normal} | Anomaly={anomaly} | Noise filtered={noise}")
    results.append(sw_df)

if not results:
    print("ERROR: ไม่มีข้อมูล — ตรวจสอบว่ารัน train_save.py แล้วหรือยัง")
    raise SystemExit(1)

final_df = pd.concat(results, ignore_index=True)
final_df.to_csv('/opt/net-model/result.csv', index=False)
print(f"\nบันทึกผลที่ result.csv ({len(final_df)} rows)")

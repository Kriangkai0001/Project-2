import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import pickle
import os
import warnings
warnings.filterwarnings("ignore")

MODELS_DIR   = '/opt/net-model/models'
BASELINE_CSV = '/opt/net-model/edge_data.csv'

# baseline แยกต่อ device — เพิ่ม entry เมื่อมี device ใหม่
BASELINE_PERIODS = {
    'PR-test-sw.netsec.local'     : ('2026-04-11', '2026-04-20'),
    'RouterProject.mynetwork.com' : ('2026-03-31', '2026-04-09'),
}

FEATURES = ['cpu_5s', 'mem_used', 'in_bps', 'out_bps',
            'in_err_rate', 'max_severity_code',
            'count_critical', 'count_warning']

os.makedirs(MODELS_DIR, exist_ok=True)

df = pd.read_csv(BASELINE_CSV)
df['time'] = pd.to_datetime(df['time'])
df = df.sort_values(['hostname', 'time']).reset_index(drop=True)

for sw_name, sw_df in df.groupby('hostname'):
    if sw_name not in BASELINE_PERIODS:
        print(f"SKIP {sw_name}: ไม่มี baseline period กำหนดใน BASELINE_PERIODS")
        continue
    b_start, b_end = BASELINE_PERIODS[sw_name]
    baseline = sw_df[
        (sw_df['time'] >= b_start) &
        (sw_df['time'] <= b_end)
    ].copy().reset_index(drop=True)

    baseline['in_bps']      = baseline['total_in_octets'].diff().clip(lower=0)
    baseline['out_bps']     = baseline['total_out_octets'].diff().clip(lower=0)
    baseline['in_err_rate'] = baseline['total_in_errors'].diff().clip(lower=0)
    for col in ['max_severity_code', 'count_critical', 'count_warning']:
        baseline[col] = baseline[col].fillna(0)
    baseline = baseline.dropna(subset=['in_bps', 'out_bps', 'in_err_rate'])

    if len(baseline) < 10:
        print(f"SKIP {sw_name}: baseline น้อยเกินไป ({len(baseline)} rows)")
        continue

    X = baseline[FEATURES]
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(contamination=0.05, random_state=42, n_estimators=100)
    model.fit(X_scaled)

    safe = sw_name.replace('.', '_').replace('/', '_')
    with open(f'{MODELS_DIR}/{safe}_iso_model.pkl', 'wb') as f:
        pickle.dump(model, f)
    with open(f'{MODELS_DIR}/{safe}_iso_scaler.pkl', 'wb') as f:
        pickle.dump(scaler, f)

    print(f"OK  {sw_name}: trained on {len(baseline)} baseline rows → saved")

print(f"\nModels saved to {MODELS_DIR}/")

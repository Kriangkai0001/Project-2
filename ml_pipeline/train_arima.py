import pandas as pd
import numpy as np
from statsmodels.tsa.arima.model import ARIMA
import warnings
warnings.filterwarnings("ignore")

df = pd.read_csv('/opt/net-model/edge_data.csv')
df['time'] = pd.to_datetime(df['time'])
df = df.sort_values('time').reset_index(drop=True)

# คำนวณ delta
df['in_bps']  = df['total_in_octets'].diff().clip(lower=0)
df['out_bps'] = df['total_out_octets'].diff().clip(lower=0)
df = df.dropna(subset=['in_bps','out_bps'])

# features ที่จะทำ ARIMA
features = {
    'cpu_5s'   : 'CPU (%)',
    'mem_used' : 'Memory Used (MB)',
    'in_bps'   : 'Traffic In (bps)',
    'out_bps'  : 'Traffic Out (bps)'
}
results = []

for feat, feat_name in features.items():
    print(f"\n=== ARIMA: {feat_name} ===")
    series = df[feat].values
    times  = df['time'].values

    preds     = []
    residuals = []
    anomalies = []

    # train window = 100, ทำนายทีละ 1 step
    train_size = 100

    for i in range(train_size, len(series)):
        train = series[i-train_size:i]
        try:
            model = ARIMA(train, order=(2,1,2))
            fit   = model.fit()
            pred  = fit.forecast(steps=1)[0]
        except:
            pred = train[-1]

        actual   = series[i]
        residual = abs(actual - pred)
        preds.append(pred)
        residuals.append(residual)

    # threshold = mean + 2*std ของ residual
    res_arr   = np.array(residuals)
    threshold = res_arr.mean() + 2 * res_arr.std()

    for i, (res, pred) in enumerate(zip(residuals, preds)):
        idx     = i + train_size
        anomaly = res > threshold
        results.append({
            'time'      : df['time'].iloc[idx],
            'hostname'  : df['hostname'].iloc[idx],
            'feature'   : feat,
            'feature_name': feat_name,
            'actual'    : series[idx],
            'predicted' : pred,
            'residual'  : res,
            'threshold' : threshold,
            'anomaly'   : anomaly
        })

    n_anom = sum(1 for r in results[-len(residuals):] if r['anomaly'])
    print(f"  Anomaly: {n_anom} / {len(residuals)} จุด (threshold={threshold:.2f})")

result_df = pd.DataFrame(results)
result_df.to_csv('/opt/net-model/result_arima.csv', index=False)
print(f"\nบันทึกผลที่ result_arima.csv ({len(result_df)} rows)")

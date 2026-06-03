import psycopg2
import pandas as pd

df = pd.read_csv('/opt/net-model/result_arima.csv')
df['time'] = pd.to_datetime(df['time'])

conn = psycopg2.connect(host="localhost", dbname="edgedb", user="netsec", password="Netsec123")
cur = conn.cursor()

for _, row in df.iterrows():
    scenario = row['scenario_name'] if pd.notna(row.get('scenario_name')) else None
    cur.execute("""
        INSERT INTO ml_arima (time, hostname, feature, feature_name, actual, predicted, residual, threshold, anomaly, scenario_name)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (time, hostname, feature) DO UPDATE SET
            actual = EXCLUDED.actual,
            predicted = EXCLUDED.predicted,
            residual = EXCLUDED.residual,
            threshold = EXCLUDED.threshold,
            anomaly = EXCLUDED.anomaly,
            scenario_name = EXCLUDED.scenario_name
    """, (
        row['time'], row['hostname'], row['feature'], row['feature_name'],
        row['actual'], row['predicted'], row['residual'], row['threshold'],
        bool(row['anomaly']), scenario
    ))

conn.commit()
print(f"ARIMA Upsert สำเร็จ {len(df)} rows")
cur.close()
conn.close()

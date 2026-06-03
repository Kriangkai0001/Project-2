import psycopg2
import pandas as pd

df = pd.read_csv('/opt/net-model/result.csv')
df['time'] = pd.to_datetime(df['time'])

conn = psycopg2.connect(host="localhost", dbname="edgedb", user="netsec", password="Netsec123")
cur = conn.cursor()

for _, row in df.iterrows():
    scenario = row['scenario_name'] if pd.notna(row.get('scenario_name')) else None
    util_pct = float(row['in_util_pct']) if pd.notna(row.get('in_util_pct')) else None
    cur.execute("""
        INSERT INTO ml_isolation_forest
        (time, hostname, anomaly, anomaly_label, anomaly_score, cpu_5s, mem_used, in_bps, out_bps, in_err_rate, scenario_name, in_util_pct)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (time, hostname) DO UPDATE SET
            anomaly = EXCLUDED.anomaly,
            anomaly_label = EXCLUDED.anomaly_label,
            cpu_5s = EXCLUDED.cpu_5s,
            mem_used = EXCLUDED.mem_used,
            in_bps = EXCLUDED.in_bps,
            out_bps = EXCLUDED.out_bps,
            in_err_rate = EXCLUDED.in_err_rate,
            scenario_name = EXCLUDED.scenario_name,
            in_util_pct = EXCLUDED.in_util_pct
    """, (
        row['time'], row['hostname'],
        int(row['anomaly']), row['anomaly_label'],
        None,
        row['cpu_5s'], row['mem_used'],
        row['in_bps'], row['out_bps'], row['in_err_rate'],
        scenario, util_pct
    ))

conn.commit()
print(f"Upsert สำเร็จ {len(df)} rows")
cur.close()
conn.close()

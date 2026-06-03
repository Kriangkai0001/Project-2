import psycopg2
import csv

conn = psycopg2.connect(
    host="localhost",
    dbname="edgedb",
    user="netsec",
    password="Netsec123"
)

query = """
    SELECT
        s.time,
        s.host,
        s.hostname,
        s.cpu_5s,
        s.mem_free,
        s.mem_used,
        s.uptime,
        SUM(i."ifHCInOctets")  AS total_in_octets,
        SUM(i."ifHCOutOctets") AS total_out_octets,
        SUM(i."ifInErrors")    AS total_in_errors,
        SUM(i."ifOutErrors")   AS total_out_errors,
        MAX(CASE WHEN i."ifType" = 6 AND i."ifHighSpeed" > 0 THEN i."ifHighSpeed" ELSE 0 END) AS max_phy_speed_mbps,
        MAX(sl.severity_code)  AS max_severity_code,
        COUNT(CASE WHEN sl.severity_code <= 3 THEN 1 END) AS count_critical,
        COUNT(CASE WHEN sl.severity_code = 4 THEN 1 END) AS count_warning
    FROM snmp s
    LEFT JOIN interface i
        ON s.hostname = i.hostname
        AND i.time >= s.time - INTERVAL '5 minutes'
        AND i.time <  s.time + INTERVAL '5 minutes'
    LEFT JOIN syslog sl
        ON (
            (s.hostname = 'PR-test-sw.netsec.local' 
             AND sl.source IN ('192.168.204.88','192.168.204.146'))
            OR
            (s.hostname = 'SW3' 
             AND sl.source = '192.168.204.4')
        )
        AND sl.time >= s.time - INTERVAL '5 minutes'
        AND sl.time <  s.time + INTERVAL '5 minutes'
    WHERE s.hostname ~ '^[A-Za-z]'
    GROUP BY s.time, s.host, s.hostname, s.cpu_5s, s.mem_free, s.mem_used, s.uptime
    ORDER BY s.hostname, s.time
"""

cur = conn.cursor()
cur.execute(query)
rows = cur.fetchall()
cols = [desc[0] for desc in cur.description]

with open('/opt/net-model/edge_data.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(cols)
    writer.writerows(rows)

print(f"Done! {len(rows)} rows exported")

cur.execute("""
    SELECT hostname, COUNT(*) FROM snmp 
    WHERE hostname ~ '^[A-Za-z]'
    GROUP BY hostname ORDER BY hostname
""")
print("\nSW ที่พบ:")
for row in cur.fetchall():
    print(f"  {row[0]} → {row[1]} rows")

conn.close()

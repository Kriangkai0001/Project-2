"""
Graph Builder Service — Network Knowledge Graph
สแกน DB ทุก 5 นาที สร้าง device → protocol tree
"""
import os, json, time, threading
from datetime import datetime
import psycopg2
from fastapi import FastAPI

DB = {
    'host': os.getenv('DB_HOST', '127.0.0.1'),
    'port': os.getenv('DB_PORT', '5432'),
    'dbname': os.getenv('DB_NAME', 'edgedb'),
    'user': os.getenv('DB_USER', 'netsec'),
    'password': os.getenv('DB_PASSWORD', 'Netsec123'),
}

# Protocol schema — table ที่ใช้เช็ค + column hostname
PROTOCOL_MAP = {
    # มีข้อมูลจริง
    'snmp':              {'table': 'snmp',               'host_col': 'hostname'},
    'interface':         {'table': 'interface',          'host_col': 'hostname'},
    'syslog':            {'table': 'syslog',             'host_col': 'hostname'},
    'anomaly_isolation': {'table': 'ml_isolation_forest','host_col': 'hostname'},
    'anomaly_arima':     {'table': 'ml_arima',           'host_col': 'hostname'},
    'cpu':               {'table': 'cpu',                'host_col': 'host'},
    'mem':               {'table': 'mem',                'host_col': 'host'},
    'disk':              {'table': 'disk',               'host_col': 'host'},
    'processes':         {'table': 'processes',          'host_col': 'host'},
    'system':            {'table': 'system',             'host_col': 'host'},
    # รออนาคต — Routing
    'ospf':              {'table': 'ospf_neighbors',     'host_col': 'hostname'},
    'bgp':               {'table': 'bgp_peers',          'host_col': 'hostname'},
    'eigrp':             {'table': 'eigrp_neighbors',    'host_col': 'hostname'},
    'rip':               {'table': 'rip_routes',         'host_col': 'hostname'},
    'static_route':      {'table': 'static_routes',      'host_col': 'hostname'},
    'mpls':              {'table': 'mpls_labels',        'host_col': 'hostname'},
    # Layer 2
    'arp':               {'table': 'arp_table',          'host_col': 'hostname'},
    'stp':               {'table': 'stp_ports',          'host_col': 'hostname'},
    'vlan':              {'table': 'vlan_table',         'host_col': 'hostname'},
    'mac_table':         {'table': 'mac_address',        'host_col': 'hostname'},
    'lldp':              {'table': 'lldp_neighbors',     'host_col': 'hostname'},
    'lacp':              {'table': 'lag_members',        'host_col': 'hostname'},
    # Services
    'dns':               {'table': 'dns_records',        'host_col': 'hostname'},
    'dhcp':              {'table': 'dhcp_leases',        'host_col': 'hostname'},
    'ntp':               {'table': 'ntp_peers',          'host_col': 'hostname'},
    'radius':            {'table': 'auth_logs',          'host_col': 'hostname'},
    'qos':               {'table': 'qos_policy',         'host_col': 'hostname'},
    # Security
    'acl':               {'table': 'acl_rules',          'host_col': 'hostname'},
    'firewall':          {'table': 'fw_rules',           'host_col': 'hostname'},
    'vpn':               {'table': 'vpn_tunnels',        'host_col': 'hostname'},
    'nat':               {'table': 'nat_table',          'host_col': 'hostname'},
    # Wireless
    'wifi_ap':           {'table': 'ap_status',         'host_col': 'hostname'},
    'wifi_client':       {'table': 'wifi_clients',      'host_col': 'hostname'},
    # Hardware
    'hw_temp':           {'table': 'hw_temp',           'host_col': 'hostname'},
    'hw_fan':            {'table': 'hw_fan',            'host_col': 'hostname'},
    'hw_psu':            {'table': 'hw_psu',            'host_col': 'hostname'},
    'hw_optics':         {'table': 'hw_optics',         'host_col': 'hostname'},
    # Flow
    'netflow':           {'table': 'netflow',           'host_col': 'hostname'},
    # HA
    'hsrp_vrrp':         {'table': 'ha_status',        'host_col': 'hostname'},
    'bfd':               {'table': 'bfd_sessions',     'host_col': 'hostname'},
    # Management
    'config_backup':     {'table': 'config_backup',    'host_col': 'hostname'},
    'firmware':          {'table': 'fw_version',       'host_col': 'hostname'},
    # Reachability
    'icmp':              {'table': 'icmp_probe',       'host_col': 'hostname'},
}

graph_cache = {}
app = FastAPI()

def get_conn():
    return psycopg2.connect(**DB)

def table_exists(cur, table):
    cur.execute(
        "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=%s)",
        (table,)
    )
    return cur.fetchone()[0]

def get_short_name(hostname):
    """PR-test-sw.netsec.local → PR-test-sw"""
    return hostname.split('.')[0].lower() if hostname else ''

def build_graph():
    global graph_cache
    try:
        conn = get_conn()
        cur  = conn.cursor()

        # ใช้ monitored_devices เป็น canonical device list
        canonical_devices = []
        if table_exists(cur, 'monitored_devices'):
            cur.execute("SELECT hostname, device_type, ip, description FROM monitored_devices WHERE active=true ORDER BY hostname")
            canonical_devices = cur.fetchall()

        # fallback: หาจาก snmp ถ้าไม่มี monitored_devices
        if not canonical_devices and table_exists(cur, 'snmp'):
            cur.execute("SELECT DISTINCT hostname, NULL, NULL, NULL FROM snmp WHERE hostname IS NOT NULL")
            canonical_devices = cur.fetchall()

        graph = {'last_updated': datetime.now().isoformat(), 'devices': {}}

        for (hostname, device_type, ip, description) in canonical_devices:
            short = get_short_name(hostname)
            graph['devices'][hostname] = {
                'device_type': device_type or 'unknown',
                'ip': ip,
                'description': description,
                'protocols': {}
            }

            for proto, cfg in PROTOCOL_MAP.items():
                table    = cfg['table']
                host_col = cfg['host_col']

                if not table_exists(cur, table):
                    graph['devices'][hostname]['protocols'][proto] = {'status': 'no_table', 'rows': 0}
                    continue

                # match ด้วย ILIKE เพื่อรองรับ hostname format ต่างกัน
                cur.execute(
                    f"SELECT COUNT(*), MAX(time) FROM {table} WHERE {host_col} ILIKE %s OR {host_col} ILIKE %s",
                    (f"{hostname}%", f"{short}%")
                )
                row      = cur.fetchone()
                count    = row[0] or 0
                last_seen = row[1].isoformat() if row[1] else None

                graph['devices'][hostname]['protocols'][proto] = {
                    'status':    'active' if count > 0 else 'no_data',
                    'rows':      count,
                    'last_seen': last_seen,
                }

        graph_cache = graph
        print(f"[graph] rebuild เสร็จ: {len(canonical_devices)} devices, {datetime.now().strftime('%H:%M:%S')}", flush=True)
        cur.close()
        conn.close()

    except Exception as e:
        print(f"[graph] ERROR: {e}", flush=True)

def rebuild_loop():
    while True:
        build_graph()
        time.sleep(300)  # rebuild ทุก 5 นาที

# Start background rebuild
t = threading.Thread(target=rebuild_loop, daemon=True)
t.start()

@app.get("/graph")
def get_graph():
    return graph_cache

@app.get("/graph/summary/all")
def get_summary():
    devices = graph_cache.get('devices', {})
    summary = {}
    for dev, data in devices.items():
        active   = [p for p, v in data['protocols'].items() if v['status'] == 'active']
        no_data  = [p for p, v in data['protocols'].items() if v['status'] == 'no_data']
        no_table = [p for p, v in data['protocols'].items() if v['status'] == 'no_table']
        summary[dev] = {
            'active':   active,
            'no_data':  no_data,
            'no_table': no_table,
        }
    return {'last_updated': graph_cache.get('last_updated'), 'devices': summary}

@app.get("/graph/{hostname}/{protocol}")
def get_protocol(hostname: str, protocol: str):
    devices = graph_cache.get('devices', {})
    for dev, data in devices.items():
        if hostname.lower() in dev.lower():
            proto_data = data['protocols'].get(protocol)
            if proto_data:
                return {'device': dev, 'protocol': protocol, **proto_data}
            return {'device': dev, 'protocol': protocol, 'status': 'unknown'}
    return {'error': 'ไม่พบ device'}

@app.get("/graph/{hostname}")
def get_device(hostname: str):
    devices = graph_cache.get('devices', {})
    for dev, data in devices.items():
        if hostname.lower() in dev.lower():
            return {'device': dev, **data}
    return {'error': 'ไม่พบ device', 'device': hostname}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=5003)

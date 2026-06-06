# ผนวก ก — โทโพโลยีและการตั้งค่าอุปกรณ์ Network

---

## ก.1 โทโพโลยีเครือข่าย

```
                    Internet
                       |
              192.168.204.1 (upstream gateway)
                       |
         ┌─────────────────────────┐
         │  RouterProject          │
         │  Gi0/0: 192.168.99.1   │  ← internal (nat inside)
         │  Gi0/1: 192.168.204.85 │  ← external (nat outside)
         │  hostname: RouterProject.mynetwork.com │
         └─────────────┬───────────┘
                       │ 192.168.99.0/24
                       │
         ┌─────────────────────────┐
         │  PR-test-sw             │
         │  Vlan1: 192.168.99.88  │
         │  Fa0/1: ACCESS-UPLINK  │  ← uplink to router
         │  Fa0/2: SERVER-AGENT   │  ← server monitoring
         │  hostname: PR-test-sw.netsec.local │
         └──────────┬──────────────┘
                    │ Fa0/2
                    │
         ┌──────────────────────────────┐
         │  Server (Ubuntu 24.04)       │
         │  192.168.99.89 (internal)    │
         │  10.252.209.28  (management) │
         │                              │
         │  Services:                   │
         │  - Telegraf (SNMP collector) │
         │  - PostgreSQL :5432          │
         │  - Grafana :8888             │
         │  - Chat API :5001            │
         │  - RAG :5002                 │
         │  - Graph :5003               │
         │  - Ollama :11434             │
         └──────────────────────────────┘
```

### อุปกรณ์ทั้งหมด

| อุปกรณ์ | Hostname | IP (internal) | IP (management) | หน้าที่ |
|---------|----------|--------------|----------------|---------|
| Server Ubuntu | — | 192.168.99.89 | 10.252.209.28 | รัน ML + Chat + DB + Grafana |
| Cisco 2960 L2 SW | PR-test-sw.netsec.local | 192.168.99.88 | — | อุปกรณ์ที่ monitor |
| Cisco 1905 Router | RouterProject.mynetwork.com | 192.168.99.1 | 192.168.204.85 | อุปกรณ์ที่ monitor + NAT |

---

## ก.2 การตั้งค่า OS Ubuntu Server

```bash
# อัพเดต OS
apt update && apt upgrade -y

# ติดตั้ง tools พื้นฐาน
apt install -y curl wget git python3 python3-pip python3-venv \
               build-essential net-tools vim postgresql nodejs npm
```

### Network Interface (Server)
```
eth0: 10.252.209.28/20  (management — เชื่อมต่อภายนอก)
eth1: 192.168.99.89/24  (monitoring — เชื่อมต่อ SW/Router)
```

---

## ก.3 Config Router (RouterProject.mynetwork.com)

**Model:** Cisco 1905/K9  
**IOS:** 15.6  
**IP:** Gi0/0 = 192.168.99.1 (inside), Gi0/1 = 192.168.204.85 (outside)

```
! ---- Interface ----
interface GigabitEthernet0/0
 ip address 192.168.99.1 255.255.255.0
 ip nat inside
 ip virtual-reassembly in
 duplex auto
 speed auto

interface GigabitEthernet0/1
 ip address 192.168.204.85 255.255.255.0
 ip nat outside
 ip virtual-reassembly in
 duplex auto
 speed auto

! ---- NAT ----
ip nat inside source list 1 interface GigabitEthernet0/1 overload
ip route 0.0.0.0 0.0.0.0 192.168.204.1
access-list 1 permit 192.168.99.0 0.0.0.255

! ---- DHCP ----
ip dhcp excluded-address 192.168.99.1 192.168.99.20
ip dhcp pool project
 network 192.168.99.0 255.255.255.0
 default-router 192.168.99.1
 dns-server 203.209.55.4

! ---- SSH ----
ip domain name mynetwork.com
ip ssh version 2
username cyberadmin privilege 15 secret 5 $1$NVGG$...
line vty 0 4
 login local
 transport input ssh

! ---- Syslog ----
logging trap debugging
logging origin-id ip
logging source-interface GigabitEthernet0/0
logging host 192.168.99.89 transport udp port 6514

! ---- SNMP v3 ----
snmp-server group TelegrafGroup v3 priv read TelegrafView
snmp-server view TelegrafView iso included
snmp-server enable traps snmp authentication linkdown linkup coldstart warmstart
snmp-server host 192.168.99.89 version 3 priv TelegrafGroup
```

> **หมายเหตุ:** SNMP user สร้างด้วย: `snmp-server user TelegrafGroup TelegrafGroup v3 auth sha cyber@mut priv aes 128 cyber@mut`  
> (command นี้ไม่โชว์ใน sh run)

---

## ก.4 Config Switch (PR-test-sw.netsec.local)

**Model:** Cisco Catalyst 2960 L2  
**IOS:** 15.0  
**IP:** Vlan1 = 192.168.99.88/24

```
! ---- Management IP ----
interface Vlan1
 ip address 192.168.99.88 255.255.255.0
ip default-gateway 192.168.99.1

! ---- Port ที่ใช้งาน ----
interface FastEthernet0/1
 description ACCESS-UPLINK        ! ← uplink ไป Router
 switchport mode access
 spanning-tree portfast

interface FastEthernet0/2
 description SERVER-AGENT         ! ← ต่อ Server monitor
 switchport mode access

! (Fa0/3 - Fa0/24: access port ว่าง)

! ---- SSH ----
ip domain-name netsec.local
ip ssh version 2
username netsec privilege 15 secret 5 $1$SvaI$...
line vty 0 15
 exec-timeout 30 0
 login local
 transport input ssh

! ---- Syslog ----
logging trap debugging
logging origin-id ip
logging source-interface Vlan1
logging host 192.168.99.89 transport udp port 6514

! ---- SNMP v3 ----
snmp-server group TelegrafGroup v3 priv write v1default
snmp-server view v1default iso included
snmp-server view TelegrafView iso included
snmp-server enable traps snmp authentication linkdown linkup coldstart warmstart
snmp-server enable traps cpu threshold
snmp-server enable traps config
snmp-server enable traps bridge newroot topologychange
snmp-server enable traps syslog
snmp-server host 192.168.99.89 version 3 priv TelegrafGroup

! ---- NTP ----
ntp server 158.108.212.149
ntp server 202.28.18.72 prefer

! ---- Spanning Tree ----
spanning-tree mode pvst
no spanning-tree vlan 204
```

> **หมายเหตุ:** SNMP user สร้างด้วย: `snmp-server user TelegrafUser TelegrafGroup v3 auth sha Netsec123 priv aes 128 PrivPass456`

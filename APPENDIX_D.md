# ผนวก ง — ผลการทดสอบ 100 คำถาม

> **รอผลการทดสอบ** — จะอัพเดตเมื่อมีผล Q&A ครบ

---

## สรุปผล

| รอบ | ✓ | ✗ | เฉลี่ย | หมายเหตุ |
|-----|---|---|--------|---------|
| Baseline (Groq+Qwen) | 97 | 0 | 78s | ดีที่สุด |
| qwen2.5:3b local | 93 | 7 | 100s | 7 ข้อ timeout ทั้งหมด |

> ✗ 7 ข้อ = **timeout 180s** ไม่ใช่ตอบผิด — qwen2.5:3b คิดนานเกิน limit

---

## ตาราง 100 คำถาม

*(อัพเดตเมื่อมีผลการทดสอบครบ)*

| ข้อ | Category | คำถาม | ผล |
|-----|----------|-------|----|
| 1 | CPU | แสดง CPU ล่าสุดของทุก hostname | ✓ |
| 2 | CPU | hostname ไหนมี CPU สูงสุดตอนนี้ | ✓ |
| 3 | CPU | แสดง CPU เฉลี่ย 24 ชั่วโมงที่ผ่านมาของทุก hostname | ✓ |
| 4 | CPU | แสดง CPU ล่าสุดของ PR-test-sw.netsec.local | ✓ |
| 5 | CPU | แสดง CPU ล่าสุดของ RouterProject.mynetwork.com | ✓ |
| 6 | CPU | แสดงช่วงเวลาที่ CPU สูงกว่า 80% ทั้งหมด | ✓ |
| 7 | CPU | แสดงประวัติ CPU ของทุก hostname ย้อนหลัง 7 วัน เรียงตามเวลา | ✓ |
| 8 | CPU | แสดง top 5 ช่วงเวลาที่ CPU สูงที่สุดในทุก hostname | ✓ |
| 9 | CPU | เปรียบเทียบ CPU ล่าสุดระหว่าง switch กับ router | ✓ |
| 10 | CPU | แสดง CPU ต่ำสุดของทุก hostname ใน 24 ชั่วโมงที่ผ่านมา | ✓ |
| 11 | Memory | แสดง memory ที่ใช้และว่างล่าสุดของทุก hostname | ✓ |
| 12 | Memory | hostname ไหนใช้ memory เกิน 80% ตอนนี้ | ✓ |
| 13 | Memory | แสดง memory ล่าสุดของ PR-test-sw.netsec.local | ✓ |
| 14 | Memory | แสดง memory ล่าสุดของ RouterProject.mynetwork.com | ✓ |
| 15 | Memory | แสดง memory usage เฉลี่ยของทุก device | ✓ |
| 16 | Memory | แสดงช่วงเวลาที่ memory ใช้สูงสุดของทุก hostname ใน 7 วันที่ผ่านมา | ✓ |
| 17 | Memory | แสดงช่วงเวลาที่ memory free ต่ำกว่า 5MB ทั้งหมด | ✓ |
| 18 | Memory | เปรียบเทียบ memory ล่าสุดระหว่าง switch กับ router | ✓ |
| 19 | Memory | แสดงประวัติ memory ใช้และว่างของทุก hostname ใน 24 ชั่วโมงที่ผ่านมา | ✓ |
| 20 | Memory | แสดง % memory ที่ใช้ของทุก hostname ล่าสุด | ✓ |
| 21 | Interface | แสดงสถานะ interface ล่าสุดของทุก hostname | ✓ |
| 22 | Interface | แสดง interface ที่ operStatus เป็น Down ทั้งหมดตอนนี้ | ✓ |
| 23 | Interface | แสดงเฉพาะ interface ที่ operStatus เป็น Up ทั้งหมด | ✓ |
| 24 | Interface | แสดงสถานะ Vlan interface ทั้งหมดบน switch | ✗ timeout |
| 25 | Interface | แสดง interface speed ของทุก port บน switch และ router | ✓ |
| 26 | Interface | แสดง port ที่ AdminStatus เป็น Down ทั้งหมด | ✓ |
| 27 | Interface | แสดงสถานะ interface ล่าสุดทั้งหมดของ RouterProject.mynetwork.com | ✓ |
| 28 | Interface | แสดงสถานะ interface ล่าสุดทั้งหมดของ PR-test-sw.netsec.local | ✓ |
| 29 | Interface | แสดง MAC address ของทุก interface ที่มีค่า | ✓ |
| 30 | Interface | นับจำนวน interface ที่ Up และ Down แยกตาม hostname | ✓ |
| 31 | Traffic | แสดง traffic ขาเข้าและขาออกสะสมล่าสุดของทุก interface | ✓ |
| 32 | Traffic | interface ไหนมี traffic สะสมสูงสุดตอนนี้ เรียง top 10 | ✓ |
| 33 | Traffic | แสดง traffic ล่าสุดของ interface ACCESS-UPLINK บน switch | ✓ |
| 34 | Traffic | แสดง interface ที่มี traffic in และ out เป็น 0 ทั้งคู่ (unused port) | ✓ |
| 35 | Traffic | แสดง traffic_flood anomaly ทั้งหมด พร้อม in_bps และ out_bps | ✓ |
| 36 | Traffic | เปรียบเทียบ traffic ขาเข้า vs ขาออกล่าสุดของทุก interface บน switch | ✓ |
| 37 | Traffic | แสดง traffic ล่าสุดของ interface Gi0/0 บน RouterProject.mynetwork.com | ✓ |
| 38 | Traffic | แสดง traffic ล่าสุดของ interface Gi0/1 บน RouterProject.mynetwork.com | ✓ |
| 39 | Traffic | แสดงช่วงเวลาที่ traffic ผิดปกติ (in_bps หรือ out_bps สูงผิดปกติ) ล่าสุด 10 รายการ | ✗ timeout |
| 40 | Traffic | สรุปจำนวน traffic_flood anomaly แต่ละวันใน 7 วันที่ผ่านมา | ✓ |
| 41 | Syslog | แสดง syslog ที่ severity เป็น error หรือ critical ล่าสุด 20 รายการ | ✓ |
| 42 | Syslog | สรุปจำนวน syslog แต่ละ severity ทั้งหมด | ✓ |
| 43 | Syslog | แสดง syslog warning ล่าสุด 20 รายการ | ✓ |
| 44 | Syslog | device (source IP) ไหนส่ง syslog มากที่สุด นับแยกตาม source | ✓ |
| 45 | Syslog | แสดง syslog ล่าสุด 50 รายการทุก severity | ✓ |
| 46 | Syslog | แสดง syslog critical ที่เกิดขึ้นใน 7 วันที่ผ่านมาทั้งหมด | ✓ |
| 47 | Syslog | แสดง syslog ทั้งหมดที่มี message ล่าสุด 30 รายการ | ✓ |
| 48 | Syslog | แสดง syslog ที่ message เกี่ยวกับ fragment หรือ overflow ล่าสุด | ✓ |
| 49 | Syslog | นับจำนวน syslog แยกตามชั่วโมงใน 24 ชั่วโมงที่ผ่านมา | ✓ |
| 50 | Syslog | แสดงจำนวน syslog แต่ละ severity แยกตาม source IP | ✓ |
| 51 | Anomaly | แสดง anomaly ล่าสุด 10 รายการ พร้อม scenario และค่า CPU, Memory, Traffic | ✓ |
| 52 | Anomaly | สรุป anomaly แต่ละ scenario ว่ามีกี่ครั้ง เรียงจากมากไปน้อย | ✓ |
| 53 | Anomaly | แสดง high_memory anomaly ล่าสุด 10 รายการ | ✓ |
| 54 | Anomaly | แสดง traffic_flood anomaly ล่าสุด 10 รายการ พร้อม in_bps และ out_bps | ✓ |
| 55 | Anomaly | แสดง port_error anomaly ทั้งหมด พร้อม in_err_rate | ✓ |
| 56 | Anomaly | แสดง high_cpu anomaly ทั้งหมด พร้อม cpu_5s | ✗ timeout |
| 57 | Anomaly | แสดง unknown_anomaly ล่าสุด 10 รายการ พร้อมค่า CPU Memory Traffic | ✓ |
| 58 | Anomaly | เปรียบเทียบจำนวน normal vs anomaly ทั้งหมดใน ml_isolation_forest | ✓ |
| 59 | Anomaly | แสดง anomaly score ต่ำสุด 10 อันดับ (ผิดปกติมากที่สุด) | ✓ |
| 60 | Anomaly | แสดง anomaly ที่เกิดขึ้นใน 24 ชั่วโมงที่ผ่านมาทั้งหมด | ✓ |
| 61 | Security | มีการ login ผิดปกติหรือ brute force ไหม | ✗ timeout |
| 62 | Security | ตรวจสอบ SSH error ล่าสุดทั้งหมด | ✓ |
| 63 | Security | IP ไหนพยายาม login ล้มเหลวบ่อยที่สุด แสดงจำนวนและช่วงเวลา | ✗ timeout |
| 64 | Security | แสดงประวัติ login สำเร็จทั้งหมดพร้อม source IP และ user | ✓ |
| 65 | Security | แสดง SSH authentication failed ทั้งหมดล่าสุด 20 รายการ | ✓ |
| 66 | Security | IP ไหน login สำเร็จหลังจาก failed หลายครั้ง (อาจเจาะระบบสำเร็จ) | ✓ |
| 67 | Security | สรุปเหตุการณ์ security ทั้งหมด จำนวน failed และ success แยกตาม source IP | ✓ |
| 68 | Security | แสดง syslog ที่เกี่ยวกับ SSH NO_MATCH หรือ UNEXPECTED_MSG ทั้งหมด | ✓ |
| 69 | Security | แสดง syslog ที่เกี่ยวกับ authentication ทั้งหมดล่าสุด 30 รายการ | ✓ |
| 70 | Security | แสดง timeline เหตุการณ์ security ทั้งหมดเรียงตามเวลา | ✓ |
| 71 | ARIMA | แสดง ARIMA anomaly ล่าสุดทั้งหมด พร้อม feature, actual, predicted, residual | ✓ |
| 72 | ARIMA | แสดง ARIMA anomaly ของ CPU ล่าสุด 10 รายการ | ✓ |
| 73 | ARIMA | แสดง ARIMA anomaly ของ memory ล่าสุด 10 รายการ | ✓ |
| 74 | ARIMA | แสดง ARIMA anomaly ของ traffic ขาเข้า (in_bps) ล่าสุด 10 รายการ | ✓ |
| 75 | ARIMA | แสดง ARIMA anomaly ของ traffic ขาออก (out_bps) ล่าสุด 10 รายการ | ✗ timeout |
| 76 | ARIMA | feature ไหนมี ARIMA anomaly บ่อยที่สุด สรุปจำนวนแยกตาม feature | ✓ |
| 77 | ARIMA | แสดง ARIMA residual สูงสุด 10 อันดับ (เกิน threshold มากที่สุด) | ✓ |
| 78 | ARIMA | เปรียบเทียบค่า actual vs predicted ของ CPU จาก ARIMA ล่าสุด 10 รายการ | ✓ |
| 79 | ARIMA | เปรียบเทียบค่า actual vs predicted ของ memory จาก ARIMA ล่าสุด 10 รายการ | ✓ |
| 80 | ARIMA | นับจำนวน ARIMA anomaly แยกตามวันใน 7 วันที่ผ่านมา | ✓ |
| 81 | Summary | สรุปสถานะระบบทั้งหมดตอนนี้ ได้แก่ CPU, Memory, Interface ที่ Down, Anomaly ล่าสุด | ✓ |
| 82 | Summary | รายงานสรุปประจำวัน: CPU, Memory, Interface, Anomaly และ Syslog Error ล่าสุด | ✓ |
| 83 | Summary | device ไหนมีปัญหามากที่สุด นับจาก anomaly และ syslog error | ✓ |
| 84 | Summary | สรุปเหตุการณ์ผิดปกติทั้งหมดใน 24 ชั่วโมงที่ผ่านมา (anomaly, syslog, error) | ✓ |
| 85 | Summary | แสดงภาพรวม health ของระบบ network: interface ที่ Down, anomaly, syslog error | ✓ |
| 86 | Summary | interface ไหนต้องการความสนใจมากที่สุด (มี error, discard, หรือ Down) | ✓ |
| 87 | Summary | แสดง interface ที่มี error หรือ discard สูงสุด 10 อันดับแรก | ✓ |
| 88 | Summary | สรุป anomaly และ syslog error ที่เกิดในช่วง 24 ชั่วโมงล่าสุด | ✓ |
| 89 | Summary | แสดงปัญหาที่เกิดซ้ำมากที่สุดในระบบ (anomaly scenario และ syslog source) | ✓ |
| 90 | Summary | รายงานสรุปสัปดาห์: จำนวน anomaly แต่ละ scenario, syslog error, interface ที่มีปัญหา | ✓ |
| 91 | Uptime | แสดง uptime ของทุก hostname เรียงจากมากไปน้อย | ✓ |
| 92 | Uptime | แสดง uptime ล่าสุดของ PR-test-sw.netsec.local เป็นกี่วัน | ✓ |
| 93 | Uptime | แสดง uptime ล่าสุดของ RouterProject.mynetwork.com เป็นกี่วัน | ✓ |
| 94 | Uptime | device ไหนมีค่า uptime น้อยที่สุด (reboot ล่าสุด) | ✓ |
| 95 | Uptime | แสดงประวัติ uptime ของทุก hostname ย้อนหลัง 7 วัน | ✓ |
| 96 | Uptime | device ไหนมีค่า uptime ต่ำผิดปกติ (อาจ reboot บ่อย) | ✓ |
| 97 | Uptime | device ที่มี uptime เกิน 30 วันมีเครื่องไหนบ้าง | ✓ |
| 98 | Uptime | เปรียบเทียบ uptime ระหว่าง switch และ router ล่าสุด | ✗ timeout |
| 99 | Uptime | device ที่ online นานที่สุดคืออะไร แสดง uptime เป็นวันและชั่วโมง | ✓ |
| 100 | Uptime | แสดง uptime เฉลี่ยของทุก device ในรูปแบบวันและชั่วโมง | ✓ |

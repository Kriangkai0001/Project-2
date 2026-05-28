# Net-Chat — Network AI Chatbot

Fine-tune **Qwen2.5-1.5B-Instruct** ด้วย LoRA สำหรับ Network AI Chatbot  
ตอบคำถามเรื่อง Cisco, Aruba, MikroTik, SNMP (OID/MIB/trap) ได้ทั้งภาษาไทยและอังกฤษ

## เทรนบนเครื่องตัวเอง (แนะนำ)

```bash
git clone https://github.com/Kriangkai0001/Project-2.git
cd Project-2
python3 -m venv netchat-env && source netchat-env/bin/activate
pip install torch transformers peft accelerate datasets jupyter ipykernel
python -m ipykernel install --user --name netchat-env --display-name "Net-Chat (CPU)"
jupyter notebook train_local.ipynb
```

ไม่ต้องมี GPU — รันได้บน CPU ทั่วไป  
ดูรายละเอียดและตัวเลือกเวลาเทรนได้ที่ [TRAINING.md](TRAINING.md)

## Data

| ไฟล์ | Pairs | ขนาด |
|------|-------|------|
| `data/combined.jsonl.gz` | 235,998 | 94MB (gz) |

แหล่งข้อมูล: serverfault, networkengineering SE, security SE, SNMP special, superuser, askubuntu, unix SE, electronics SE, vendor docs

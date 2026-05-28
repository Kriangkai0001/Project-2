# Training Guide — Net-Chat (Network AI Chatbot)

เป้าหมาย: Fine-tune **Qwen2.5-1.5B-Instruct** ด้วย LoRA บน network Q&A data → ได้ model ที่ตอบคำถามเรื่อง Cisco, Aruba, MikroTik, SNMP ได้

---

## Hardware ที่ใช้ทดสอบ

| รายการ | ค่า |
|--------|-----|
| CPU | Intel Core i5-13420H |
| RAM | 14 GB |
| GPU | ไม่มี (CPU only) |
| OS | Ubuntu/Linux |

---

## Dataset

| ไฟล์ | Pairs | ขนาด | เนื้อหา |
|------|-------|------|---------|
| `data/combined.jsonl.gz` | **235,998** | 94 MB (gz) | รวมทุกแหล่ง |
| `data/network_qa.jsonl` | 14,532 | ~15 MB | Network Engineering SE เท่านั้น |

**Format:**
```json
{"instruction": "What is OSPF?", "output": "OSPF (Open Shortest Path First) is..."}
```

---

## Option A: Local Machine (แนะนำ)

ใช้ Jupyter Notebook `train_local.ipynb` ที่อยู่ใน repo นี้ — รันได้บนเครื่อง CPU ทั่วไป ไม่ต้องใช้ GPU หรือ Cloud

### 1. Clone repo

```bash
git clone https://github.com/Kriangkai0001/Project-2.git
cd Project-2
```

### 2. สร้าง Python virtual environment

```bash
python3 -m venv netchat-env
source netchat-env/bin/activate
```

### 3. ติดตั้ง dependencies

```bash
pip install torch transformers peft accelerate datasets jupyter ipykernel
python -m ipykernel install --user --name netchat-env --display-name "Net-Chat (CPU)"
```

> ไม่ต้องมี CUDA — torch CPU เพียงพอสำหรับการเทรน

### 4. เปิด Notebook

```bash
jupyter notebook train_local.ipynb
```

### 5. รัน Notebook ทีละ Cell

| Cell | ทำอะไร |
|------|---------|
| 1 | ตรวจสอบ environment (Python, PyTorch, device) |
| 2 | แตกไฟล์ dataset `.gz` → `.jsonl` |
| 3 | ดูตัวอย่าง dataset |
| 4 | โหลด Qwen2.5-1.5B-Instruct + LoRA config |
| 5 | เตรียม dataset — **ตั้ง `NUM_SAMPLES` ที่นี่** |
| 6 | เทรน model |
| 7 | ทดสอบ model ด้วยคำถาม network |
| 8 | Merge LoRA + Export GGUF (สำหรับ Ollama) |

### เวลาที่ใช้ (CPU i5-13420H)

| NUM_SAMPLES | เวลา | ใช้ทำอะไร |
|-------------|------|-----------|
| 500 | ~15–30 นาที | ทดสอบว่า pipeline ทำงาน |
| 2,000 | ~1–2 ชั่วโมง | ผลดีขึ้น เหมาะสำหรับสาธิต |
| 10,000 | ~8–12 ชั่วโมง | เทรนข้ามคืน |
| 235,998 | ~10–15 วัน | full training (ไม่แนะนำ CPU) |

> แนะนำใช้ `NUM_SAMPLES = 2000` สำหรับ demo/ส่งงาน

---

## Option B: Google Colab (ถ้าต้องการ GPU — ฟรี)

### Setup

```python
!git clone https://github.com/Kriangkai0001/Project-2.git
%cd Project-2
!pip install transformers peft accelerate datasets bitsandbytes -q

!wget https://github.com/Kriangkai0001/Project-2/raw/main/data/combined.jsonl.gz
!gunzip combined.jsonl.gz && mkdir -p data && mv combined.jsonl data/
```

### Train (T4 GPU, ~15 นาที สำหรับ 5,000 samples)

```python
!python scripts/train.py \
  --data data/combined.jsonl \
  --samples 5000 \
  --epochs 2 \
  --batch 8 \
  --output model/lora-adapter
```

---

## ติดตั้งเข้า Ollama (หลัง export GGUF แล้ว)

```bash
# สร้าง Modelfile
cat > Modelfile << 'EOF'
FROM ./netchat-q4.gguf
PARAMETER temperature 0.7
PARAMETER top_p 0.9
SYSTEM "คุณคือ Network AI Assistant ที่เชี่ยวชาญด้าน Cisco, Aruba, MikroTik, SNMP (OID/MIB/trap) ตอบเป็นภาษาไทยหรืออังกฤษตามที่ถาม"
EOF

# โหลดเข้า Ollama
ollama create netchat -f Modelfile

# ทดสอบ
ollama run netchat "SNMP OID คืออะไร"
ollama run netchat "Cisco show interface status command"
```

---

## File Structure

```
Project-2/
├── data/
│   └── combined.jsonl.gz     ← training data (235,998 pairs, 94MB)
├── scripts/
│   ├── train.py              ← fine-tune LoRA (script mode)
│   └── merge_and_export.py   ← merge LoRA → GGUF
├── model/                    ← output หลังเทรน (สร้างโดย train.py)
│   ├── lora-adapter/
│   ├── merged/
│   └── netchat-q4.gguf
├── train_local.ipynb         ← Jupyter Notebook สำหรับเทรนบนเครื่อง (แนะนำ)
├── TRAINING.md               ← ไฟล์นี้
└── README.md
```

---

## Notes

- **LoRA r=16** → เทรนแค่ 0.44% ของ parameters (~6.8M จาก 1.5B) → ใช้ RAM น้อย เร็ว
- **Base model** จะ download จาก HuggingFace ครั้งแรก ~3GB — ต้องมีเน็ต
- **Q4_K_M** quantization → model ขนาด ~1GB ใช้ RAM ~1.5GB ขณะรัน
- `combined.jsonl` ครอบคลุม: networking, sysadmin, security, SNMP — model ตอบได้กว้าง

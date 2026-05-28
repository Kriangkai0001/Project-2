"""
Fine-tune Qwen2.5-1.5B-Instruct ด้วย LoRA บน Network Q&A data
ใช้กับ combined.jsonl (235,998 pairs) หรือ network_qa.jsonl (14,532 pairs)

ใช้งาน:
  python train.py                        # เทรนทั้งหมด (ใช้ GPU)
  python train.py --samples 5000         # จำกัด 5000 samples (ทดสอบ)
  python train.py --model Qwen/Qwen2.5-3B-Instruct  # ใช้ model ใหญ่กว่า
"""
import os
import json
import argparse
import torch
from datasets import Dataset
from transformers import (
    AutoTokenizer, AutoModelForCausalLM,
    TrainingArguments, Trainer, DataCollatorForSeq2Seq
)
from peft import LoraConfig, get_peft_model, TaskType

DEFAULT_MODEL   = 'Qwen/Qwen2.5-1.5B-Instruct'
DEFAULT_DATA    = 'data/combined.jsonl'
DEFAULT_OUTPUT  = 'model/lora-adapter'
MAX_LENGTH      = 512

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--model',   default=DEFAULT_MODEL,  help='HuggingFace model name')
    p.add_argument('--data',    default=DEFAULT_DATA,   help='path to .jsonl training data')
    p.add_argument('--output',  default=DEFAULT_OUTPUT, help='output directory for LoRA adapter')
    p.add_argument('--samples', type=int, default=0,    help='limit samples (0 = all)')
    p.add_argument('--epochs',  type=int, default=2)
    p.add_argument('--batch',   type=int, default=4,    help='per_device_train_batch_size')
    p.add_argument('--lr',      type=float, default=2e-4)
    return p.parse_args()

def load_data(path, max_samples=0):
    records = []
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if max_samples > 0:
        records = records[:max_samples]
    print(f"โหลด {len(records):,} samples จาก {path}")
    return Dataset.from_list(records)

def format_prompt(example):
    instruction = example.get('instruction', example.get('question', ''))
    output      = example.get('output', example.get('answer', ''))
    return f"<|im_start|>user\n{instruction}<|im_end|>\n<|im_start|>assistant\n{output}<|im_end|>"

def tokenize_fn(example, tokenizer):
    text   = format_prompt(example)
    tokens = tokenizer(text, truncation=True, max_length=MAX_LENGTH, padding='max_length')
    tokens['labels'] = tokens['input_ids'].copy()
    return tokens

def main():
    args = parse_args()

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    dtype  = torch.float16 if device == 'cuda' else torch.float32
    print(f"Device: {device} | dtype: {dtype}")

    print(f"โหลด model: {args.model}")
    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=dtype,
        trust_remote_code=True,
        device_map='auto' if device == 'cuda' else 'cpu'
    )

    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj']
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    dataset   = load_data(args.data, args.samples)
    tokenized = dataset.map(
        lambda x: tokenize_fn(x, tokenizer),
        remove_columns=dataset.column_names,
        num_proc=4
    )

    training_args = TrainingArguments(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=max(1, 16 // args.batch),
        save_steps=500,
        logging_steps=100,
        learning_rate=args.lr,
        fp16=(device == 'cuda'),
        bf16=False,
        warmup_ratio=0.03,
        lr_scheduler_type='cosine',
        dataloader_num_workers=2,
        report_to='none',
        save_total_limit=2,
        load_best_model_at_end=False,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        data_collator=DataCollatorForSeq2Seq(tokenizer, model=model, padding=True)
    )

    print("เริ่ม fine-tune...")
    trainer.train()

    os.makedirs(args.output, exist_ok=True)
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print(f"บันทึก LoRA adapter → {args.output}")
    print("Next: รัน merge_and_export.py เพื่อ export เป็น GGUF สำหรับ Ollama")

if __name__ == '__main__':
    main()

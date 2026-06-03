import psycopg2
import pandas as pd
import pickle
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

DB_CONN    = dict(host="localhost", dbname="edgedb", user="netsec", password="Netsec123")
MODEL_PATH = '/opt/net-model/models/scenario_classifier.pkl'
FEATURES   = ['cpu_5s', 'mem_used', 'in_bps', 'out_bps', 'in_err_rate']

conn = psycopg2.connect(**DB_CONN)
df = pd.read_sql("""
    SELECT cpu_5s, mem_used, in_bps, out_bps, in_err_rate, scenario_name
    FROM ml_isolation_forest
    WHERE scenario_name IS NOT NULL
      AND scenario_name != 'unknown_anomaly'
      AND anomaly_label = 'anomaly'
""", conn)
conn.close()

print(f"Training data: {len(df)} rows")
print(df['scenario_name'].value_counts().to_string())

X = df[FEATURES].fillna(0)
y = df['scenario_name']

min_class = y.value_counts().min()
stratify_arg = y if min_class >= 2 else None
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=stratify_arg)
print(f"\nTrain: {len(X_train)} rows | Test: {len(X_test)} rows")

# evaluate บน test set ก่อน
clf_eval = RandomForestClassifier(n_estimators=100, class_weight='balanced', random_state=42, n_jobs=-1)
clf_eval.fit(X_train, y_train)
y_pred = clf_eval.predict(X_test)

print(f"\nTest Accuracy: {accuracy_score(y_test, y_pred):.4f}")
print("\nClassification Report (test set):")
print(classification_report(y_test, y_pred))

# retrain บน full data แล้วค่อย save
clf_final = RandomForestClassifier(n_estimators=100, class_weight='balanced', random_state=42, n_jobs=-1)
clf_final.fit(X, y)

with open(MODEL_PATH, 'wb') as f:
    pickle.dump(clf_final, f)

print(f"Saved (trained on full data) → {MODEL_PATH}")

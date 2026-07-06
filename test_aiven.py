import os
import pymysql
import urllib.parse

uri = os.environ.get('AIVEN_URI', 'mysql://avnadmin:REDACTED@db-exp2-abdullahjalalg-aa92.h.aivencloud.com:20289/defaultdb?ssl-mode=REQUIRED')
parsed = urllib.parse.urlparse(uri)
conn = pymysql.connect(
    host=parsed.hostname,
    port=parsed.port,
    user=parsed.username,
    password=parsed.password,
    database=parsed.path.lstrip('/'),
    ssl={'ssl_mode': 'REQUIRED'}
)
cursor = conn.cursor()
cursor.execute("SELECT id, category, description, value, created_at FROM expenses ORDER BY id DESC LIMIT 5")
for row in cursor.fetchall():
    print(row)
conn.close()

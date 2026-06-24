import os
import subprocess
import urllib.parse
import getpass

def get_mysql_bin(exe_name):
    # Common paths for MySQL on Windows
    paths = [
        r"C:\Program Files\MySQL\MySQL Server 8.0\bin",
        r"C:\Program Files\MySQL\MySQL Server 8.1\bin",
        r"C:\Program Files\MySQL\MySQL Server 8.2\bin",
        r"C:\Program Files\MySQL\MySQL Server 8.4\bin",
        r"C:\Program Files\MySQL\MySQL Workbench 8.0"
    ]
    for path in paths:
        full_path = os.path.join(path, exe_name)
        if os.path.exists(full_path):
            return full_path
    
    print(f"Error: Could not find {exe_name}. Please make sure MySQL is installed.")
    exit(1)

def main():
    print("=========================================")
    print("  Expense Manager Database Migrator")
    print("=========================================\n")
    
    # Local config from .env
    local_db = "expense_manager"
    local_user = "root"
    local_pass = "musa4200"
    
    print(f"-> Found local database: {local_db}")
    
    aiven_uri = input("\nPaste your Aiven MySQL URI (starts with mysql://):\n> ").strip()
    
    if not aiven_uri.startswith("mysql://") and not aiven_uri.startswith("mysql+pymysql://"):
        print("Invalid URI format. It should look like: mysql://user:password@host:port/dbname")
        return
        
    aiven_uri = aiven_uri.replace("mysql+pymysql://", "mysql://")
    parsed = urllib.parse.urlparse(aiven_uri)
    
    target_user = parsed.username
    target_pass = urllib.parse.unquote(parsed.password)
    target_host = parsed.hostname
    target_port = parsed.port or 3306
    target_db = parsed.path.lstrip('/')
    
    mysqldump_exe = get_mysql_bin("mysqldump.exe")
    mysql_exe = get_mysql_bin("mysql.exe")
    
    dump_file = "local_db_dump.sql"
    
    print("\n[1/3] Exporting local database...")
    dump_cmd = [
        mysqldump_exe,
        "-h", "localhost",
        "-u", local_user,
        f"-p{local_pass}",
        "--no-tablespaces",
        "--set-gtid-purged=OFF",
        local_db
    ]
    
    with open(dump_file, "w", encoding="utf-8") as f:
        subprocess.run(dump_cmd, stdout=f, check=True)
    
    print(f"[2/3] Uploading database to Aiven (Host: {target_host})...")
    print("      This might take a minute depending on your internet speed.")
    
    upload_cmd = [
        mysql_exe,
        "-h", target_host,
        "-P", str(target_port),
        "-u", target_user,
        f"-p{target_pass}",
        target_db
    ]
    
    with open(dump_file, "r", encoding="utf-8") as f:
        subprocess.run(upload_cmd, stdin=f, check=True)
        
    print("\n[3/3] Cleaning up...")
    os.remove(dump_file)
    
    print("\n✅ Migration Complete!")
    print("Your Aiven cloud database now contains all your local users and expenses.")
    print("You can now securely log into your web app!")

if __name__ == "__main__":
    main()

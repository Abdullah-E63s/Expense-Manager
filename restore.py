from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)

# Assuming DB is already configured in your main config file
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    is_deleted = db.Column(db.Boolean, default=False)
    deleted_at = db.Column(db.DateTime, nullable=True)

@app.route('/')
def index():
    return render_template('restore.html')

@app.route('/api/restore', methods=['POST'])
def restore_user():
    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"error": "Email is required"}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    if not user.is_deleted:
        return jsonify({"message": "User is already active"}), 200

    user.is_deleted = False
    user.deleted_at = None
    db.session.commit()

    return jsonify({"message": f"✅ Account for {email} has been successfully restored."}), 200


if __name__ == '__main__':
    app.run(debug=True)

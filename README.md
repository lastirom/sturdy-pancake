E-COMMERCE CATALOG – POLYGLOT PERSISTENCE

A full-stack e-commerce demo using MySQL for structured data (products, users, orders, cart) and MongoDB for flexible attributes & reviews.

WHAT'S INSIDE

- Admin dashboard – manage products, upload images, edit custom attributes, view orders.
- Customer storefront – browse products, add reviews, shopping cart, checkout (with address check).
- JWT authentication – users can register, login, and have persistent carts.
- Transactional orders – stock updates and order creation in a single MySQL transaction.

PREREQUISITES

- Node.js (v14 or newer)
- MySQL Server
- MongoDB Server (local)

SETUP FROM ZIP

If you received this project as a ZIP file:

1. Extract the ZIP anywhere on your computer.
2. Open a terminal inside the extracted folder, then go to the backend directory:
   cd ecommerce-catalog/backend
3. Install dependencies:
   npm install
4. Create a .env file inside backend/ with the following content (adjust passwords/credentials as needed):
   |PORT=5000|
   |---------|
   |MYSQL_HOST=localhost|
   |MYSQL_USER=root|
   |MYSQL_PASSWORD=your_mysql_password|
   |MYSQL_DATABASE=ecommerce|
   |MONGODB_URI=mongodb://localhost:27017|
   |MONGODB_DB=ecommerce_catalog|
   |JWT_SECRET=your_super_secret_key_change_this|
6. Set up MySQL – run the SQL script below (or use the provided database.sql file) to create the database and tables.
7. Start MongoDB – run mongod in a separate terminal (or start it as a service).
8. Start the backend:
   npm start
   You should see "Server running on http://localhost:5000".
9. Open the frontend in your browser (double-click or open via file menu):
   - Admin dashboard – frontend/admin-dashboard.html
   - Customer store – frontend/store.html

MYSQL SCHEMA

Run the following SQL in your MySQL client:

CREATE DATABASE IF NOT EXISTS ecommerce;
USE ecommerce;

CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    stock INT NOT NULL,
    category VARCHAR(100),
    image_url VARCHAR(500) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    birthdate DATE,
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivery_date DATE,
    total_amount DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    price_at_time DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE user_cart (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_product (user_id, product_id)
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_user_cart_user_id ON user_cart(user_id);

ENVIRONMENT VARIABLES

| Variable | Description |
|----------|-------------|
| PORT | Server port (default 5000) |
| MYSQL_HOST | MySQL host (usually localhost) |
| MYSQL_USER | MySQL username |
| MYSQL_PASSWORD | MySQL password |
| MYSQL_DATABASE | Database name (ecommerce) |
| MONGODB_URI | MongoDB connection string |
| MONGODB_DB | MongoDB database name (ecommerce_catalog) |
| JWT_SECRET | Secret for signing JWTs (change it) |

TROUBLESHOOTING

Problem: Cannot find module 'bcrypt'
Solution: Run npm install inside backend

Problem: MySQL connection error
Solution: Check MySQL is running and .env credentials are correct

Problem: MongoDB connection error
Solution: Run mongod in a separate terminal

Problem: Order fails with "address required"
Solution: Logged-in users must add a shipping address in their profile

Problem: Images not showing
Solution: Ensure backend/uploads folder exists and has images

NOTES

- The backend serves static frontend files from ../frontend.
- Product attributes and reviews are stored in MongoDB collections (attributes, reviews).
- All core data (products, users, orders, cart) are stored in MySQL.
- This project is intended for educational use (DCIT 55 final project)

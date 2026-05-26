// Import Express web framework
const express = require('express');
// Import CORS middleware to allow cross-origin requests
const cors = require('cors');
// Import path module for safe file path handling
const path = require('path');
// Import file system module to check/create folders
const fs = require('fs');
// Import multer for handling multipart/form-data (file uploads)
const multer = require('multer');
// Import bcrypt for password hashing and comparison
const bcrypt = require('bcrypt');
// Import jsonwebtoken for creating and verifying JWTs
const jwt = require('jsonwebtoken');
// Import MySQL connection pool from local file
const mysqlPool = require('./db/mysql');
// Import MongoDB connection functions from local file
const { connectMongo, getDb } = require('./db/mongodb');
// Import ObjectId to convert string IDs to MongoDB ObjectId type
const { ObjectId } = require('mongodb');
// Load environment variables from .env file
require('dotenv').config();

// Create an instance of an Express application
const app = express();

// Enable CORS for all routes (allows frontend to call API from another origin)
app.use(cors());
// Parse incoming JSON request bodies and populate req.body
app.use(express.json());
// Serve static files (HTML, CSS, JS) from the frontend folder
app.use(express.static('../frontend'));

// Build absolute path to the 'uploads' folder inside the backend directory
const uploadDir = path.join(__dirname, 'uploads');
// If the uploads folder doesn't exist, create it
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
// Serve uploaded images via /uploads URL path
app.use('/uploads', express.static(uploadDir));

// Configure multer disk storage
const storage = multer.diskStorage({
    // Destination folder for uploaded files
    destination: (req, file, cb) => cb(null, uploadDir),
    // Generate unique filename: timestamp + random number + original extension
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
// Create multer instance with storage config and 5MB file size limit
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ----- Authentication Routes -----

// POST /api/register – create a new user account
app.post('/api/register', async (req, res) => {
    // Extract user fields from request body
    const { email, password, full_name, birthdate, address } = req.body;
    // Validate required fields
    if (!email || !password || !full_name) {
        return res.status(400).json({ error: 'Email, password and full name required' });
    }
    try {
        // Hash the plain password with 10 salt rounds
        const hashed = await bcrypt.hash(password, 10);
        // Insert new user into MySQL users table
        const [result] = await mysqlPool.query(
            'INSERT INTO users (email, password_hash, full_name, birthdate, address) VALUES (?, ?, ?, ?, ?)',
            [email, hashed, full_name, birthdate || null, address || null]
        );
        // Create JWT token valid for 7 days
        const token = jwt.sign({ userId: result.insertId, email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        // Return token and user object (excluding password)
        res.status(201).json({ token, user: { id: result.insertId, email, full_name, birthdate, address } });
    } catch (err) {
        // Handle duplicate email error
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already exists' });
        // General server error
        res.status(500).json({ error: err.message });
    }
});

// POST /api/login – authenticate existing user
app.post('/api/login', async (req, res) => {
    // Extract email and password from request
    const { email, password } = req.body;
    // Validate both fields present
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        // Find user by email in MySQL
        const [rows] = await mysqlPool.query('SELECT * FROM users WHERE email = ?', [email]);
        // If no user found, return unauthorized
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = rows[0];
        // Compare provided password with stored hash
        const match = await bcrypt.compare(password, user.password_hash);
        // If password doesn't match, return unauthorized
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });
        // Generate new JWT token for the authenticated user
        const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        // Return token and user data (excluding password hash)
        res.json({ token, user: { id: user.id, email: user.email, full_name: user.full_name, birthdate: user.birthdate, address: user.address } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/profile – get current user's profile (requires token in Authorization header)
app.get('/api/profile', async (req, res) => {
    // Get Authorization header from request
    const authHeader = req.headers.authorization;
    // If no token provided, return 401
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    // Extract token from "Bearer <token>" format
    const token = authHeader.split(' ')[1];
    try {
        // Verify and decode the JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Fetch user data (excluding password) from MySQL
        const [rows] = await mysqlPool.query(
            'SELECT id, email, full_name, birthdate, address FROM users WHERE id = ?',
            [decoded.userId]
        );
        // If user not found, return 404
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
        // Return user object
        res.json(rows[0]);
    } catch (err) {
        // Token invalid or expired
        res.status(401).json({ error: 'Invalid token' });
    }
});

// PUT /api/profile – update user profile (requires token)
app.put('/api/profile', async (req, res) => {
    // Get Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    // Extract fields to update from request body
    const { full_name, birthdate, address, email } = req.body;
    try {
        // Verify token and get userId
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Update user record in MySQL
        await mysqlPool.query(
            'UPDATE users SET full_name = ?, birthdate = ?, address = ?, email = ? WHERE id = ?',
            [full_name, birthdate || null, address || null, email, decoded.userId]
        );
        res.json({ message: 'Profile updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----- Persistent Cart Routes (for authenticated users) -----

// GET /api/cart – retrieve user's cart items
app.get('/api/cart', async (req, res) => {
    // Get Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
    const token = authHeader.split(' ')[1];
    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Query user_cart joined with products to get product details
        const [rows] = await mysqlPool.query(
            `SELECT c.product_id, p.name, p.price, p.stock, c.quantity 
             FROM user_cart c 
             JOIN products p ON c.product_id = p.id 
             WHERE c.user_id = ?`,
            [decoded.userId]
        );
        // Return cart items as JSON
        res.json(rows);
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// POST /api/cart – replace entire cart (sync from frontend)
app.post('/api/cart', async (req, res) => {
    // Get Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
    const token = authHeader.split(' ')[1];
    // Get items array from request body
    const { items } = req.body;
    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
        // Delete all existing cart items for this user (replace strategy)
        await mysqlPool.query('DELETE FROM user_cart WHERE user_id = ?', [userId]);
        // Insert each new item into user_cart
        for (const item of items) {
            if (item.quantity > 0) {
                await mysqlPool.query(
                    'INSERT INTO user_cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
                    [userId, item.product_id, item.quantity]
                );
            }
        }
        res.json({ message: 'Cart saved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----- Products CRUD (MySQL) -----

// POST /api/products – create a new product (with optional image upload)
app.post('/api/products', upload.single('image'), async (req, res) => {
    // Extract product fields from request body
    const { name, price, stock, category } = req.body;
    // Validate required fields
    if (!name || price === undefined || stock === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    try {
        let image_path = null;
        // If an image was uploaded, store its relative URL
        if (req.file) image_path = `/uploads/${req.file.filename}`;
        // Insert product into MySQL products table
        const [result] = await mysqlPool.query(
            'INSERT INTO products (name, price, stock, category, image_url) VALUES (?, ?, ?, ?, ?)',
            [name, price, stock, category, image_path]
        );
        // Return the newly created product
        res.status(201).json({ id: result.insertId, name, price, stock, category, image_url: image_path });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/products – get all products
app.get('/api/products', async (req, res) => {
    try {
        // Select all products from MySQL
        const [rows] = await mysqlPool.query('SELECT * FROM products');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/products/:id – update an existing product (optional new image)
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
    // Extract updated fields from request
    const { name, price, stock, category } = req.body;
    const productId = req.params.id;
    try {
        let image_path = null;
        if (req.file) {
            // If a new image was uploaded, use its path
            image_path = `/uploads/${req.file.filename}`;
        } else {
            // Otherwise, keep the existing image URL from the database
            const [rows] = await mysqlPool.query('SELECT image_url FROM products WHERE id = ?', [productId]);
            image_path = rows[0]?.image_url || null;
        }
        // Update product record in MySQL
        await mysqlPool.query(
            'UPDATE products SET name=?, price=?, stock=?, category=?, image_url=? WHERE id=?',
            [name, price, stock, category, image_path, productId]
        );
        res.json({ message: 'Product updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/products/:id – delete product and cascade delete related MongoDB data
app.delete('/api/products/:id', async (req, res) => {
    const productId = parseInt(req.params.id);
    try {
        // Delete product from MySQL (foreign keys will handle related tables)
        await mysqlPool.query('DELETE FROM products WHERE id = ?', [productId]);
        // Get MongoDB database instance
        const db = getDb();
        // Delete all attributes associated with this product from MongoDB
        await db.collection('attributes').deleteMany({ product_id: productId });
        // Delete all reviews associated with this product from MongoDB
        await db.collection('reviews').deleteMany({ product_id: productId });
        res.json({ message: 'Product and related MongoDB data deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----- Orders (MySQL) with transaction support -----

// POST /api/orders – place an order (requires authentication and shipping address)
app.post('/api/orders', async (req, res) => {
    // Get Authorization header and validate
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
    const token = authHeader.split(' ')[1];
    let userId;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    // Get items array from request body
    const { items } = req.body;
    if (!items || !items.length) {
        return res.status(400).json({ error: 'No items in cart' });
    }

    // Get a MySQL connection from the pool (for transaction)
    const connection = await mysqlPool.getConnection();
    try {
        // Start a database transaction
        await connection.beginTransaction();

        let total = 0;
        const productUpdates = [];
        // Loop through each item to validate stock and calculate total
        for (const item of items) {
            // SELECT ... FOR UPDATE locks the row to prevent race conditions
            const [rows] = await connection.query(
                'SELECT name, price, stock FROM products WHERE id = ? FOR UPDATE',
                [item.product_id]
            );
            if (rows.length === 0) throw new Error(`Product ${item.product_id} not found`);
            if (rows[0].stock < item.quantity) throw new Error(`Insufficient stock for ${rows[0].name}`);
            total += rows[0].price * item.quantity;
            productUpdates.push({
                id: item.product_id,
                name: rows[0].name,
                price: rows[0].price,
                quantity: item.quantity,
                newStock: rows[0].stock - item.quantity
            });
        }

        // Get user's address and personal info (address must exist to place order)
        const [userRows] = await connection.query('SELECT address, full_name, email FROM users WHERE id = ?', [userId]);
        if (!userRows[0]?.address) {
            throw new Error('Please update your shipping address in your profile before ordering');
        }

        // Calculate delivery date = today + 7 days
        const deliveryDate = new Date();
        deliveryDate.setDate(deliveryDate.getDate() + 7);
        const formattedDate = deliveryDate.toISOString().split('T')[0];

        // Insert order header into orders table
        const [orderResult] = await connection.query(
            'INSERT INTO orders (user_id, customer_name, customer_email, delivery_date, total_amount) VALUES (?, ?, ?, ?, ?)',
            [userId, userRows[0].full_name, userRows[0].email, formattedDate, total]
        );
        const orderId = orderResult.insertId;

        // Insert each order item and update product stock
        for (const prod of productUpdates) {
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, product_name, quantity, price_at_time) VALUES (?, ?, ?, ?, ?)',
                [orderId, prod.id, prod.name, prod.quantity, prod.price]
            );
            await connection.query('UPDATE products SET stock = ? WHERE id = ?', [prod.newStock, prod.id]);
        }

        // Clear the user's cart after successful order
        await connection.query('DELETE FROM user_cart WHERE user_id = ?', [userId]);

        // Commit transaction (all changes become permanent)
        await connection.commit();
        res.status(201).json({ orderId, delivery_date: formattedDate, total });
    } catch (err) {
        // Rollback transaction on error
        await connection.rollback();
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        // Release connection back to the pool
        connection.release();
    }
});

// GET /api/orders – get all orders with product names (for admin panel)
app.get('/api/orders', async (req, res) => {
    try {
        // Main query: orders with a concatenated summary of items
        const [orders] = await mysqlPool.query(`
            SELECT o.*, 
                   GROUP_CONCAT(CONCAT(oi.product_name, ' (x', oi.quantity, ')') SEPARATOR ', ') AS items_summary
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            GROUP BY o.id
            ORDER BY o.order_date DESC
        `);
        // For each order, fetch the full list of items (as array)
        for (const order of orders) {
            const [items] = await mysqlPool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
            order.items = items;
        }
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----- Attributes (MongoDB) – flexible product specifications -----

// POST /api/attributes – upsert (insert or update) attributes for a product
app.post('/api/attributes', async (req, res) => {
    const { product_id, attributes } = req.body;
    if (!product_id || !attributes) return res.status(400).json({ error: 'product_id and attributes required' });
    try {
        const db = getDb();
        // Use updateOne with upsert: true to insert if not exists, otherwise update
        await db.collection('attributes').updateOne(
            { product_id: parseInt(product_id) },               // filter by product_id
            { $set: { product_id: parseInt(product_id), ...attributes, updated_at: new Date() } }, // merge attributes
            { upsert: true }                                    // insert if missing
        );
        res.json({ message: 'Attributes saved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/attributes/:product_id – get attributes for a product
app.get('/api/attributes/:product_id', async (req, res) => {
    try {
        const db = getDb();
        const doc = await db.collection('attributes').findOne({ product_id: parseInt(req.params.product_id) });
        // Return empty object if none found (simpler for frontend)
        res.json(doc || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----- Reviews (MongoDB) – customer feedback -----

// POST /api/reviews – add a review (requires authentication)
app.post('/api/reviews', async (req, res) => {
    // Get Authorization header and verify token
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Login required to post a review' });
    const token = authHeader.split(' ')[1];
    let userId;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    const { product_id, rating, comment } = req.body;
    if (!product_id || !rating) return res.status(400).json({ error: 'product_id and rating required' });
    try {
        // Get user's full name to store as reviewer name
        const [userRows] = await mysqlPool.query('SELECT full_name FROM users WHERE id = ?', [userId]);
        const userName = userRows[0]?.full_name || 'User';
        const db = getDb();
        const review = {
            product_id: parseInt(product_id),
            rating: parseInt(rating),
            comment: comment || '',
            user: userName,
            created_at: new Date()
        };
        // Insert review into MongoDB
        const result = await db.collection('reviews').insertOne(review);
        review._id = result.insertedId;
        res.status(201).json(review);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/reviews/:product_id – get all reviews for a product (sorted newest first)
app.get('/api/reviews/:product_id', async (req, res) => {
    try {
        const db = getDb();
        const reviews = await db.collection('reviews')
            .find({ product_id: parseInt(req.params.product_id) })
            .sort({ created_at: -1 })  // descending by creation date
            .toArray();
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/reviews/:id – delete a review by its MongoDB ObjectId
app.delete('/api/reviews/:id', async (req, res) => {
    try {
        const db = getDb();
        // Convert string ID to MongoDB ObjectId for proper deletion
        await db.collection('reviews').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ message: 'Review deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----- Start the server -----

// Async function to start the server after connecting to MongoDB
async function start() {
    // Establish MongoDB connection
    await connectMongo();
    // Use port from environment variable or default to 5000
    const PORT = process.env.PORT || 5000;
    // Start listening for incoming requests
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
// Execute the start function
start();
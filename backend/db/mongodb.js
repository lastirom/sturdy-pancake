const { MongoClient } = require('mongodb');
require('dotenv').config();

const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectMongo() {
    await client.connect();
    db = client.db(process.env.MONGODB_DB);
    console.log('Connected to MongoDB');
}

function getDb() {
    if (!db) throw new Error('MongoDB not connected');
    return db;
}

module.exports = { connectMongo, getDb };
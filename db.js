/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: @quelora/common/db.js */
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

// Internal Singleton state
let connectionPromise = null;
let isEventsRegistered = false;

/**
 * Sets up Mongoose connection event listeners and graceful shutdown handlers.
 * Ensures that listeners are only registered once.
 */
const setupHandlers = () => {
    if (isEventsRegistered) return;

    mongoose.connection.on('connected', () => console.log('✅ MongoDB: Connected.'));
    mongoose.connection.on('error', (err) => console.error('❌ MongoDB: Runtime error:', err));
    mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB: Connection lost. Reconnecting...'));

    /**
     * Closes the MongoDB connection gracefully when the process is terminated.
     * @param {string} signal - The termination signal received (e.g., SIGINT, SIGTERM).
     */
    const shutdown = async (signal) => {
        await mongoose.connection.close(false);
        console.log(`[${signal}] MongoDB: Connection closed.`);
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    isEventsRegistered = true;
};

/**
 * Main connection function. 
 * Establishes a connection to MongoDB using a Singleton pattern to prevent 
 * multiple connections (especially useful in Docker or serverless environments).
 * * @returns {Promise<typeof mongoose>} The Mongoose connection promise.
 */
const connect = async () => {
    // If a connection promise is already in progress or resolved, return it.
    // This prevents multiple simultaneous connections.
    if (connectionPromise) return connectionPromise;

    if (!MONGO_URI) {
        console.error('❌ MONGO_URI is missing in ENV');
        process.exit(1);
    }

    // Mongoose configuration tailored for Production stability
    mongoose.set('debug', true);
    mongoose.set('bufferCommands', false); // Prevents memory leaks if the DB connection goes down

    connectionPromise = mongoose.connect(MONGO_URI, {
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 5000,
        autoIndex: process.env.NODE_ENV !== 'production', // Disable autoIndex in production for performance
    }).then((conn) => {
        setupHandlers();
        return conn;
    }).catch((err) => {
        connectionPromise = null; // Reset the promise state to allow retries upon failure
        throw err;
    });

    return connectionPromise;
};

/**
 * --- THE COMPATIBILITY SECRET ---
 * In JavaScript, functions are objects. We export the 'connect' function 
 * as the default module export, but attach additional properties to it 
 * so it can be utilized in various ways depending on the importing file's needs.
 */

// 1. Define the main export as the connect function itself
const hybridExport = connect;

// 2. Attach the mongoose instance to avoid redundant 'require' calls in other files
hybridExport.mongoose = mongoose;

// 3. Attach aliases for flexible importing (e.g., const { connectDB } = require('./db'))
hybridExport.connect = connect;
hybridExport.connectDB = connect;

module.exports = hybridExport;
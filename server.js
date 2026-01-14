const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASS  // Your Gmail App Password
  }
});

const sendEmail = async (to, subject, html) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      html: html
    };

    // Only try to send if we have credentials, otherwise log mock
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log(`[MOCK EMAIL] To: ${to} | Subject: ${subject} (Configure .env for real emails)`);
      return true;
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL SENT] To: ${to} | MessageID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// MongoDB Connection
// In a real app, use process.env.MONGO_URI. For this demo, we'll try to connect but fallback gracefully or use a local URI.
// If you don't have MongoDB running, these endpoints will just fail or we can mock them.
// Let's assume the user might not have a running DB, so we'll log errors but keep server running.
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/cookieshop');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    // process.exit(1); // Don't exit functionality completely if DB fails for demo purposes
  }
};

connectDB();

// Routes
app.get('/', (req, res) => {
  res.send('Cookie Shop API is running...');
});

// Import Routes
// const productRoutes = require('./routes/productRoutes');
// app.use('/api/products', productRoutes);

// Define Product Model inline or import (We will import, but let's just setup basic route here for now)
// Settings Schema
const settingsSchema = new mongoose.Schema({
  storeName: { type: String, default: 'CookieShop' },
  email: { type: String, default: 'admin@cookieshop.com' },
  phone: { type: String, default: '' },
  currency: { type: String, default: 'LKR (Rs)' }
}, { strict: false }); // Allow flexibility for future settings

const Settings = mongoose.model('Settings', settingsSchema);

// Settings Routes
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching settings' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const update = req.body;
    // Upsert: update if exists, insert if not
    const settings = await Settings.findOneAndUpdate({}, update, { new: true, upsert: true });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Error updating settings' });
  }
});

const Product = require('./models/Product');

// Product Routes
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({});
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, price, description, images, category, stock } = req.body;
    const product = new Product({
      name,
      price,
      description,
      image: images && images.length > 0 ? images[0] : '', // Main image for backward compatibility
      images,
      category,
      stock
    });
    const createdProduct = await product.save();
    res.status(201).json(createdProduct);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Invalid product data' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, price, description, images, category, stock } = req.body;
    const product = await Product.findById(req.params.id);

    if (product) {
      product.name = name || product.name;
      product.price = price || product.price;
      product.description = description || product.description;
      product.category = category || product.category;
      product.stock = stock !== undefined ? stock : product.stock;
      if (images) {
        product.images = images;
        product.image = images[0] || '';
      }

      const updatedProduct = await product.save();
      res.json(updatedProduct);
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (product) {
      await product.deleteOne();
      res.json({ message: 'Product removed' });
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

const Order = require('./models/Order');

// Order Route
// Order Route
app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items, total } = req.body;

    // 1. Validate Stock
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        throw new Error(`Product ${item.name} not found`);
      }
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${item.name}. Available: ${product.stock}`);
      }

      // 2. Deduct Stock immediately (No transaction for standalone mongo)
      product.stock -= item.quantity;
      await product.save();
    }

    // 3. Create Order
    const order = new Order({
      customer,
      items,
      totalAmount: total,
      status: 'Pending' // Explicitly set status
    });
    const createdOrder = await order.save();

    // 5. Send Customer Invoice Email
    const emailTemplate = `
            <div style="font-family: Arial, sans-serif; max-w-600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <h1 style="color: #db2777; margin: 0;">CookieShop</h1>
                    <p style="color: #666; font-size: 14px;">Thank you for your order!</p>
                </div>
                
                <div style="margin-bottom: 20px; padding: 15px; background-color: #f9fafb; border-radius: 8px;">
                    <p style="margin: 5px 0;"><strong>Order ID:</strong> #${createdOrder._id}</p>
                    <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                    <p style="margin: 5px 0;"><strong>Status:</strong> <span style="color: #d97706;">Pending</span></p>
                </div>

                <div style="margin-bottom: 20px;">
                    <h3 style="border-bottom: 2px solid #db2777; padding-bottom: 10px; color: #333;">Billing Details</h3>
                    <p style="margin: 5px 0;"><strong>Name:</strong> ${customer.name}</p>
                    <p style="margin: 5px 0;"><strong>Address:</strong> ${customer.address}</p>
                    <p style="margin: 5px 0;"><strong>Phone:</strong> ${customer.phone}</p>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <thead>
                        <tr style="background-color: #f3f4f6;">
                            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #e5e7eb;">Item</th>
                            <th style="padding: 10px; text-align: center; border-bottom: 2px solid #e5e7eb;">Qty</th>
                            <th style="padding: 10px; text-align: right; border-bottom: 2px solid #e5e7eb;">Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(item => `
                            <tr>
                                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.name}</td>
                                <td style="padding: 10px; text-align: center; border-bottom: 1px solid #e5e7eb;">${item.quantity}</td>
                                <td style="padding: 10px; text-align: right; border-bottom: 1px solid #e5e7eb;">Rs${item.price}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="2" style="padding: 15px; text-align: right; font-weight: bold;">Total Amount:</td>
                            <td style="padding: 15px; text-align: right; font-weight: bold; color: #db2777; font-size: 18px;">Rs${total}</td>
                        </tr>
                    </tfoot>
                </table>

                <div style="text-align: center; color: #888; font-size: 12px; margin-top: 30px;">
                    <p>If you have any questions, reply to this email or call us at +94 (70) 160-4885.</p>
                    <p>&copy; ${new Date().getFullYear()} CookieShop. All rights reserved.</p>
                </div>
            </div>
        `;

    sendEmail(customer.email, `Order Confirmation #${createdOrder._id}`, emailTemplate);

    // Send Admin Notification (simplified version)
    const adminEmailContent = `
            <h2>New Order Received!</h2>
            <p><strong>Order ID:</strong> ${createdOrder._id}</p>
            <p><strong>Customer:</strong> ${customer.name}</p>
            <p><strong>Total:</strong> Rs${total}</p>
        `;
    const settings = await Settings.findOne();
    const adminEmail = settings?.email || 'admin@cookieshop.com';
    sendEmail(adminEmail, `New Order Alert #${createdOrder._id}`, adminEmailContent);

    res.status(201).json(createdOrder);
  } catch (error) {
    console.error("Order processing error:", error);
    res.status(400).json({ message: error.message || 'Order failed' });
  }
});

// Update Order Status
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Send Customer Notification Email
    const customerEmailContent = `
            <h2>Order Update</h2>
            <p>Hi ${order.customer.name},</p>
            <p>Your order <strong>#${order._id}</strong> status has been updated to: <strong style="color: #db2777;">${status}</strong>.</p>
            <p>Thank you for shopping with us!</p>
        `;
    sendEmail(order.customer.email, `Order Status Update: ${status}`, customerEmailContent);

    res.json(order);
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Failed to update order" });
  }
});

// Update Order Status
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Send Customer Notification Email
    const customerEmailContent = `
            <h2>Order Update</h2>
            <p>Hi ${order.customer.name},</p>
            <p>Your order <strong>#${order._id}</strong> status has been updated to: <strong style="color: #db2777;">${status}</strong>.</p>
            <p>Thank you for shopping with us!</p>
        `;
    sendEmail(order.customer.email, `Order Status Update: ${status}`, customerEmailContent);

    res.json(order);
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Failed to update order" });
  }
});

// Get Single Order
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (order) {
      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

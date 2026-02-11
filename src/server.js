import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection } from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import groupRoutes from './routes/groupRoutes.js';
import pledgeRoutes from './routes/pledgeRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import commentsRoutes from './routes/commentsRoutes.js';
import messagesRoutes from './routes/messagesRoutes.js';
import noticesRoutes from './routes/noticesRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import subGoalsRoutes from './routes/subGoalsRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import recurringPledgesRoutes from './routes/recurringPledgesRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// MIDDLEWARE - Must come BEFORE routes!
// ==========================================
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ==========================================
// ROUTES
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/pledges', pledgeRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/notices', noticesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/sub-goals', subGoalsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/recurring-pledges', recurringPledgesRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments', paymentRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ==========================================
// START SERVER
// ==========================================
const startServer = async () => {
  try {
    await testConnection();
    app.listen(PORT, () => {
      console.log(`✓ Webale server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

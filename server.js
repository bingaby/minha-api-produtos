const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['https://www.centrodecompra.com.br', 'https://centrodecompra.com.br'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Configurar CORS para o Express
app.use(cors({
  origin: ['https://www.centrodecompra.com.br', 'https://centrodecompra.com.br'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());

// Servir arquivos estáticos (exemplo: favicon, imagens estáticas)
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do PostgreSQL
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: 5432,
  ssl: { rejectUnauthorized: false },
});

// Configuração do Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configuração do Multer com CloudinaryStorage
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'centrodecompra',
    allowed_formats: ['jpg', 'png', 'jpeg'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }],
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite 5MB
});

// Middleware de autenticação JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// Rota para favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Health check da API + banco
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Estatísticas (protegida)
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const totalProducts = await pool.query('SELECT COUNT(*) FROM produtos');
    const totalViews = await pool.query('SELECT SUM(views) FROM produtos WHERE views IS NOT NULL');
    const totalSales = await pool.query('SELECT SUM(sales) FROM produtos WHERE sales IS NOT NULL');
    res.json({
      success: true,
      data: {
        totalProducts: parseInt(totalProducts.rows[0].count) || 0,
        totalViews: parseInt(totalViews.rows[0].sum) || 0,
        totalSales: parseInt(totalSales.rows[0].sum) || 0,
      },
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({ success: false, error: 'Erro ao obter estatísticas' });
  }
});

// Listar produtos com paginação e busca (protegida)
app.get('/api/produtos', authenticateToken, async (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = 'SELECT * FROM produtos WHERE 1=1';
    const values = [];
    let idx = 1;

    if (search) {
      query += ` AND (nome ILIKE $${idx} OR descricao ILIKE $${idx})`;
      values.push(`%${search}%`);
      idx++;
    }

    query += ` ORDER BY id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    values.push(limit, offset);

    const result = await pool.query(query, values);

    // Contar total com mesma condição
    let countQuery = 'SELECT COUNT(*) FROM produtos WHERE 1=1';
    const countValues = [];
    if (search) {
      countQuery += ' AND (nome ILIKE $1 OR descricao ILIKE $1)';
      countValues.push(`%${search}%`);
    }
    const totalResult = await pool.query(countQuery, countValues);

    const total = parseInt(totalResult.rows[0].count);
    res.json({ success: true, data: result.rows, total });
  } catch (error) {
    console.error('Erro ao obter produtos:', error);
    res.status(500).json({ success: false, error: 'Erro ao obter produtos' });
  }
});

// Listar produtos pública (sem autenticação)
app.get('/api/produtos-public', async (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = 'SELECT * FROM produtos WHERE 1=1';
    const values = [];
    let idx = 1;

    if (search) {
      query += ` AND (nome ILIKE $${idx} OR descricao ILIKE $${idx})`;
      values.push(`%${search}%`);
      idx++;
    }

    query += ` ORDER BY id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    values.push(limit, offset);

    const result = await pool.query(query, values);

    // Contar total com mesma condição
    let countQuery = 'SELECT COUNT(*) FROM produtos WHERE 1=1';
    const countValues = [];
    if (search) {
      countQuery += ' AND (nome ILIKE $1 OR descricao ILIKE $1)';
      countValues.push(`%${search}%`);
    }
    const totalResult = await pool.query(countQuery, countValues);

    const total = parseInt(totalResult.rows[0].count);
    res.json({ success: true, data: result.rows, total });
  } catch (error) {
    console.error('Erro ao obter produtos (público):', error);
    res.status(500).json({ success: false, error: 'Erro ao obter produtos' });
  }
});

// Obter produto por ID (protegida)
app.get('/api/produtos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Produto não encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Erro ao obter produto:', error);
    res.status(500).json({ success: false, error: 'Erro ao obter produto' });
  }
});

// Upload de imagem (exemplo, rota protegida)
app.post('/api/upload', authenticateToken, upload.single('imagem'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Nenhuma imagem enviada' });
  // URL da imagem no Cloudinary
  res.json({ success: true, url: req.file.path });
});

// WebSocket básico para notificações (exemplo)
io.on('connection', (socket) => {
  console.log(`Usuário conectado: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Usuário desconectado: ${socket.id}`);
  });

  // Exemplo de evento customizado
  socket.on('nova-oferta', (data) => {
    // Broadcast para todos menos para quem enviou
    socket.broadcast.emit('nova-oferta', data);
  });
});

// Inicialização do servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

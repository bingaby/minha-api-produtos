// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const socketIo = require('socket.io');
const http = require('http');
const fs = require('fs').promises; // Para limpar arquivos temporários

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'https://www.centrodecompra.com.br',
      'https://minha-api-produtos.onrender.com',
      'https://centrodecompra.onrender.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ dest: 'uploads/' });

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://www.centrodecompra.com.br',
    'https://minha-api-produtos.onrender.com',
    'https://centrodecompra.onrender.com'
  ],
  credentials: true
}));
app.use(express.json());

// Middleware para autenticação
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token !== process.env.ADMIN_TOKEN) {
    console.log('Autenticação falhou: Token inválido');
    return res.status(403).json({ status: 'error', message: 'Acesso negado' });
  }
  next();
}

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'success', message: 'API e banco de dados estão funcionando' });
  } catch (error) {
    console.error('Erro no health check:', error);
    res.status(500).json({ status: 'error', message: 'Erro no servidor ou banco de dados' });
  }
});

// Adicionar produto
app.post('/api/produtos', upload.array('imagens', 5), authenticateToken, async (req, res) => {
  try {
    const { nome, preco, categoria, loja, link, descricao } = req.body;
    console.log('Dados recebidos:', { nome, preco, categoria, loja, link, descricao, files: req.files });

    const imagens = req.files ? await Promise.all(req.files.map(async file => {
      const result = await cloudinary.uploader.upload(file.path);
      await fs.unlink(file.path); // Limpar arquivo temporário
      return result.secure_url;
    })) : [];
    console.log('Imagens enviadas para Cloudinary:', imagens);

    const query = `
      INSERT INTO produtos (nome, preco, categoria, loja, link, descricao, imagens, views, sales)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0)
      RETURNING *;
    `;
    const values = [nome, parseFloat(preco), categoria, loja, link, descricao || '', imagens];
    const { rows } = await pool.query(query, values);
    console.log('Produto inserido no banco:', rows[0]);

    io.emit('novoProduto', rows[0]); // Emitir evento Socket.IO
    res.status(201).json({ status: 'success', data: rows[0] });
  } catch (error) {
    console.error('Erro ao adicionar produto:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao adicionar produto' });
  }
});

// Buscar produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const { page = 1, limit = 12, categoria, loja, busca, sort } = req.query;
    let query = 'SELECT * FROM produtos';
    const values = [];
    let conditions = [];

    if (categoria && categoria !== 'todas') {
      conditions.push(`categoria = $${values.length + 1}`);
      values.push(categoria);
    }
    if (loja && loja !== 'todas') {
      conditions.push(`loja = $${values.length + 1}`);
      values.push(loja);
    }
    if (busca) {
      conditions.push(`nome ILIKE $${values.length + 1}`);
      values.push(`%${busca}%`);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    if (sort === 'price-asc') query += ' ORDER BY preco ASC';
    else if (sort === 'price-desc') query += ' ORDER BY preco DESC';
    else query += ' ORDER BY id DESC';

    query += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, (page - 1) * limit);

    console.log('Consulta SQL:', query, 'Valores:', values);
    const { rows } = await pool.query(query, values);
    const totalQuery = 'SELECT COUNT(*) FROM produtos' + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
    const total = await pool.query(totalQuery, values.slice(0, -2));
    console.log('Produtos retornados:', rows);
    res.json({ status: 'success', data: rows, total: parseInt(total.rows[0].count) });
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao buscar produtos' });
  }
});

// Outras rotas (PUT, DELETE) podem ser mantidas conforme necessário...

server.listen(process.env.PORT || 3000, () => {
  console.log('Servidor rodando na porta', process.env.PORT || 3000);
});

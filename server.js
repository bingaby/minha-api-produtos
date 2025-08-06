const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken'); // Opcional para autenticação

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['https://www.centrodecompra.com.br', 'https://centrodecompra.com.br'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

app.use(cors({
  origin: ['https://www.centrodecompra.com.br', 'https://centrodecompra.com.br'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json());

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

// Configuração do Multer com Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'centrodecompra',
    allowed_formats: ['jpg', 'png', 'jpeg'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }],
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB por imagem
});

// Middleware de autenticação (opcional)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, process.env.JWT_SECRET || 'seu-segredo-aqui', (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// Rota de health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Rota para estatísticas
app.get('/api/stats', async (req, res) => {
  try {
    const totalProducts = await pool.query('SELECT COUNT(*) FROM produtos');
    const totalViews = await pool.query('SELECT SUM(views) FROM produtos WHERE views IS NOT NULL');
    const totalSales = await pool.query('SELECT SUM(sales) FROM produtos WHERE sales IS NOT NULL');
    res.json({
      totalProducts: parseInt(totalProducts.rows[0].count) || 0,
      totalViews: parseInt(totalViews.rows[0].sum) || 0,
      totalSales: parseInt(totalSales.rows[0].sum) || 0,
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({ error: 'Erro ao obter estatísticas' });
  }
});

// Rota para obter todos os produtos
app.get('/api/produtos', async (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = 'SELECT * FROM produtos WHERE 1=1';
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      query += ` AND (nome ILIKE $1 OR descricao ILIKE $1)`;
    }

    query += ` ORDER BY id DESC LIMIT $2 OFFSET $3`;
    values.push(limit, offset);

    const result = await pool.query(query, values);
    const totalResult = await pool.query(
      'SELECT COUNT(*) FROM produtos WHERE 1=1' + (search ? ' AND (nome ILIKE $1 OR descricao ILIKE $1)' : ''),
      search ? [search] : []
    );

    const total = parseInt(totalResult.rows[0].count);
    res.json({ data: result.rows, total });
  } catch (error) {
    console.error('Erro ao obter produtos:', error);
    res.status(500).json({ error: 'Erro ao obter produtos' });
  }
});

// Rota para obter um produto específico
app.get('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Erro ao obter produto ${id}:`, error);
    res.status(500).json({ error: 'Erro ao obter produto' });
  }
});

// Rota para adicionar produto
app.post('/api/produtos', upload.array('imagens', 5), async (req, res) => {
  const { nome, preco, categoria, loja, link, descricao } = req.body;
  const imagens = req.files ? req.files.map(file => file.path) : [];

  if (!nome || !preco || !categoria || !loja || !link) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO produtos (nome, preco, categoria, loja, link, imagens, descricao, views, sales) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0) RETURNING *',
      [nome, parseFloat(preco), categoria, loja, link, JSON.stringify(imagens), descricao]
    );
    const produto = result.rows[0];
    io.emit('novoProduto', produto);
    res.status(201).json({ message: 'Produto adicionado com sucesso', data: produto });
  } catch (error) {
    console.error('Erro ao adicionar produto:', error);
    res.status(500).json({ error: 'Erro ao adicionar produto' });
  }
});

// Rota para atualizar produto
app.put('/api/produtos/:id', upload.array('imagens', 5), async (req, res) => {
  const { id } = req.params;
  const { nome, preco, categoria, loja, link, descricao, imagensExistentes } = req.body;
  let imagens = [];

  try {
    // Combinar imagens existentes com novas
    if (imagensExistentes) {
      imagens = Array.isArray(imagensExistentes) ? imagensExistentes : JSON.parse(imagensExistentes || '[]');
    }
    if (req.files && req.files.length > 0) {
      const novasImagens = req.files.map(file => file.path);
      imagens = [...imagens, ...novasImagens];
    }

    if (!nome || !preco || !categoria || !loja || !link) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    const result = await pool.query(
      'UPDATE produtos SET nome = $1, preco = $2, categoria = $3, loja = $4, link = $5, imagens = $6, descricao = $7 WHERE id = $8 RETURNING *',
      [nome, parseFloat(preco), categoria, loja, link, JSON.stringify(imagens), descricao, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const produto = result.rows[0];
    io.emit('produtoAtualizado', produto);
    res.json({ message: 'Produto atualizado com sucesso', data: produto });
  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
});

// Rota para excluir produto
app.delete('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT imagens FROM produtos WHERE id = $1', [id]);
    if (result.rows.length > 0) {
      const imagens = JSON.parse(result.rows[0].imagens || '[]');
      for (const url of imagens) {
        const publicId = url.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`centrodecompra/${publicId}`).catch(err => console.error('Erro ao excluir imagem:', err));
      }
    }

    const deleteResult = await pool.query('DELETE FROM produtos WHERE id = $1 RETURNING *', [id]);
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    io.emit('produtoExcluido', { id });
    res.json({ message: 'Produto excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir produto:', error);
    res.status(500).json({ error: 'Erro ao excluir produto' });
  }
});

// Rota para excluir imagem específica do Cloudinary
app.delete('/api/imagem/:publicId', async (req, res) => {
  const { publicId } = req.params;

  try {
    await cloudinary.uploader.destroy(`centrodecompra/${publicId}`);
    res.json({ message: 'Imagem excluída com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir imagem:', error);
    res.status(500).json({ error: 'Erro ao excluir imagem' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

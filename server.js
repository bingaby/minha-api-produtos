const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');

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
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }],
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB por imagem
}).array('imagens', 5); // Até 5 imagens por produto

// Rota de health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Rota para obter todos os produtos
app.get('/api/produtos', async (req, res) => {
  const { page = 1, limit = 12, categoria, loja, busca } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = 'SELECT * FROM produtos WHERE 1=1';
    const values = [];

    if (categoria && categoria !== 'todas') {
      values.push(categoria);
      query += ` AND categoria = $${values.length}`;
    }

    if (loja && loja !== 'todas') {
      values.push(loja);
      query += ` AND loja = $${values.length}`;
    }

    if (busca) {
      values.push(`%${busca}%`);
      query += ` AND (nome ILIKE $${values.length} OR descricao ILIKE $${values.length})`;
    }

    query += ` ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await pool.query(query, values);
    const totalResult = await pool.query(
      'SELECT COUNT(*) FROM produtos WHERE 1=1' +
        (categoria && categoria !== 'todas' ? ' AND categoria = $1' : '') +
        (loja && loja !== 'todas' ? ` AND loja = $${categoria && categoria !== 'todas' ? 2 : 1}` : '') +
        (busca ? ` AND (nome ILIKE $${(categoria && categoria !== 'todas') + (loja && loja !== 'todas') + 1} OR descricao ILIKE $${(categoria && categoria !== 'todas') + (loja && loja !== 'todas') + 1})` : ''),
      values.slice(0, values.length - 2)
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
      console.log(`[API] Produto ${id} não encontrado`);
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`[API] Erro ao obter produto ${id}:`, error);
    res.status(500).json({ error: 'Erro ao obter produto' });
  }
});

// Rota para adicionar produto
app.post('/api/produtos', upload, async (req, res) => {
  const { nome, preco, categoria, loja, link, descricao } = req.body;
  const imagens = req.files ? req.files.map(file => file.path) : [];

  if (!nome || !preco || !categoria || !loja || !link) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO produtos (nome, preco, categoria, loja, link, imagens, descricao) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
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
app.put('/api/produtos/:id', upload, async (req, res) => {
  const { id } = req.params;
  const { nome, preco, categoria, loja, link, descricao, imagensExistentes } = req.body;
  let imagens = [];

  try {
    // Combinar imagens existentes com novas
    if (imagensExistentes) {
      imagens = JSON.parse(imagensExistentes || '[]');
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
    // Excluir imagens do Cloudinary
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

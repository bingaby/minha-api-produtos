require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
const port = process.env.PORT || 3000;

// Configuração do Express
app.use(express.json());
app.use(cors());

// Configuração do Multer para upload em memória
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Configuração do Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configuração do PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ===================================
// ROTAS DO BACKEND
// ===================================

// Rota para cadastrar um novo produto
app.post('/api/produtos', upload.array('imagens', 10), async (req, res) => {
  const { nome, descricao, preco, link, categoria, loja } = req.body;
  const imagens = req.files;

  if (!nome || !descricao || !preco || !link || !categoria || !loja || !imagens || imagens.length === 0) {
    return res.status(400).json({ error: 'Todos os campos, incluindo as imagens, são obrigatórios.' });
  }

  try {
    const uploadedImages = await Promise.all(imagens.map(async (file) => {
      const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${file.buffer.toString('base64')}`, {
        folder: 'produtos',
      });
      return result.secure_url;
    }));

    const client = await pool.connect();
    const query = `
      INSERT INTO produtos (nome, descricao, preco, link, categoria, loja, imagens)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [nome, descricao, preco, link, categoria, loja, uploadedImages];
    const result = await client.query(query, values);
    client.release();

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao cadastrar produto:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota para buscar todos os produtos com filtros e paginação
app.get('/api/produtos', async (req, res) => {
  const { page = 1, limit = 12, categoria, loja, busca } = req.query;
  const offset = (page - 1) * limit;

  try {
    const client = await pool.connect();
    let query = 'SELECT * FROM produtos';
    const values = [];
    const conditions = [];

    if (categoria && categoria !== 'todas') {
      conditions.push(`categoria = $${values.length + 1}`);
      values.push(categoria);
    }
    if (loja && loja !== 'todas') {
      conditions.push(`loja = $${values.length + 1}`);
      values.push(loja);
    }
    if (busca) {
      conditions.push(`(nome ILIKE $${values.length + 1} OR descricao ILIKE $${values.length + 1})`);
      values.push(`%${busca}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY id DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
    values.push(limit, offset);

    const result = await client.query(query, values);
    const countQuery = 'SELECT COUNT(*) FROM produtos' + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
    const countResult = await client.query(countQuery, values.slice(0, -2));
    const total = parseInt(countResult.rows[0].count);

    client.release();
    res.json({ data: result.rows, total });
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota para excluir um produto por ID
app.delete('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const client = await pool.connect();
    const query = 'DELETE FROM produtos WHERE id = $1 RETURNING *';
    const result = await client.query(query, [id]);
    client.release();

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    res.status(200).json({ message: `Produto com ID ${id} excluído com sucesso`, produto: result.rows[0] });
  } catch (err) {
    console.error('Erro ao excluir produto:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

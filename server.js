require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Rota para buscar um produto por ID
app.get('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM produtos WHERE id = $1', [id]);
    client.release();
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar produto:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota para cadastrar um novo produto
app.post('/api/produtos', upload.array('imagens', 10), async (req, res) => {
  const { nome, descricao, preco, link, categoria, loja } = req.body;
  const imagens = req.files;

  // Validação de campos obrigatórios
  if (!nome || !descricao || !preco || !link || !categoria || !loja) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }

  // Validação de comprimento
  if (nome.length > 255) {
    return res.status(400).json({ error: 'O nome do produto deve ter no máximo 255 caracteres.' });
  }
  if (descricao.length > 255) {
    return res.status(400).json({ error: 'A descrição deve ter no máximo 255 caracteres.' });
  }
  if (link.length > 255) {
    return res.status(400).json({ error: 'O link deve ter no máximo 255 caracteres.' });
  }
  if (loja.length > 255) {
    return res.status(400).json({ error: 'A loja deve ter no máximo 255 caracteres.' });
  }
  if (categoria.length > 255) {
    return res.status(400).json({ error: 'A categoria deve ter no máximo 255 caracteres.' });
  }

  // Validação de preço
  const precoNum = parseFloat(preco);
  if (isNaN(precoNum) || precoNum < 0) {
    return res.status(400).json({ error: 'O preço deve ser um número válido maior ou igual a zero.' });
  }

  try {
    const uploadedImages = imagens && imagens.length > 0
      ? await Promise.all(imagens.map(async (file) => {
          const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${file.buffer.toString('base64')}`, {
            folder: 'produtos',
          });
          return result.secure_url;
        }))
      : [];

    const client = await pool.connect();
    const query = `
      INSERT INTO produtos (nome, descricao, preco, link, categoria, loja, imagens)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [nome, descricao, precoNum, link, categoria, loja, uploadedImages];
    const result = await client.query(query, values);
    client.release();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao cadastrar produto:', err);
    res.status(500).json({ error: `Erro interno do servidor: ${err.message}` });
  }
});

// Rota para atualizar um produto
app.put('/api/produtos/:id', upload.array('imagens', 10), async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, preco, link, categoria, loja } = req.body;
  const imagens = req.files;

  // Validação de campos obrigatórios
  if (!nome || !descricao || !preco || !link || !categoria || !loja) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }

  // Validação de comprimento
  if (nome.length > 255) {
    return res.status(400).json({ error: 'O nome do produto deve ter no máximo 255 caracteres.' });
  }
  if (descricao.length > 255) {
    return res.status(400).json({ error: 'A descrição deve ter no máximo 255 caracteres.' });
  }
  if (link.length > 255) {
    return res.status(400).json({ error: 'O link deve ter no máximo 255 caracteres.' });
  }
  if (loja.length > 255) {
    return res.status(400).json({ error: 'A loja deve ter no máximo 255 caracteres.' });
  }
  if (categoria.length > 255) {
    return res.status(400).json({ error: 'A categoria deve ter no máximo 255 caracteres.' });
  }

  // Validação de preço
  const precoNum = parseFloat(preco);
  if (isNaN(precoNum) || precoNum < 0) {
    return res.status(400).json({ error: 'O preço deve ser um número válido maior ou igual a zero.' });
  }

  try {
    const uploadedImages = imagens && imagens.length > 0
      ? await Promise.all(imagens.map(async (file) => {
          const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${file.buffer.toString('base64')}`, {
            folder: 'produtos',
          });
          return result.secure_url;
        }))
      : null;

    const client = await pool.connect();
    const query = `
      UPDATE produtos 
      SET nome = $1, descricao = $2, preco = $3, link = $4, categoria = $5, loja = $6, imagens = COALESCE($7, imagens)
      WHERE id = $8
      RETURNING *
    `;
    const values = [nome, descricao, precoNum, link, categoria, loja, uploadedImages, id];
    const result = await client.query(query, values);
    client.release();

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao atualizar produto:', err);
    res.status(500).json({ error: `Erro interno do servidor: ${err.message}` });
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

// Rota para excluir um produto
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
    res.json({ message: `Produto com ID ${id} excluído com sucesso`, produto: result.rows[0] });
  } catch (err) {
    console.error('Erro ao excluir produto:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

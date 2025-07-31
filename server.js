const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Conexão com PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // necessário para Render
});

// Apenas conexão (NÃO DROPA NEM CRIA TABELA!)
pool.connect((err) => {
  if (err) {
    console.error('Erro ao conectar ao PostgreSQL:', err);
    process.exit(1);
  }
  console.log('✅ Conectado ao PostgreSQL com sucesso');
});

// Rotas

// GET - Listar todos os produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json({ status: 'success', data: rows, total: rows.length });
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
    res.status(500).json({ status: 'error', message: 'Erro ao buscar produtos' });
  }
});

// POST - Adicionar novo produto
app.post('/api/produtos', async (req, res) => {
  const { nome, descricao, preco, imagens, categoria, loja, link } = req.body;

  if (!nome || !preco || !categoria || !loja || !link) {
    return res.status(400).json({ status: 'error', message: 'Campos obrigatórios ausentes' });
  }

  try {
    const query = `
      INSERT INTO produtos (nome, descricao, preco, imagens, categoria, loja, link)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [nome, descricao, preco, imagens, categoria, loja, link];

    const result = await pool.query(query, values);
    res.status(201).json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao adicionar produto:', err);
    res.status(500).json({ status: 'error', message: 'Erro ao adicionar produto' });
  }
});

// DELETE - Excluir produto por ID
app.delete('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM produtos WHERE id = $1 RETURNING *', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
    }

    res.json({ status: 'success', message: 'Produto excluído', data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao excluir produto:', err);
    res.status(500).json({ status: 'error', message: 'Erro ao excluir produto' });
  }
});

// PUT - Editar produto por ID
app.put('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, preco, imagens, categoria, loja, link } = req.body;

  try {
    const result = await pool.query(
      `UPDATE produtos
       SET nome = $1, descricao = $2, preco = $3, imagens = $4, categoria = $5, loja = $6, link = $7
       WHERE id = $8
       RETURNING *`,
      [nome, descricao, preco, imagens, categoria, loja, link, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
    }

    res.json({ status: 'success', message: 'Produto atualizado', data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar produto:', err);
    res.status(500).json({ status: 'error', message: 'Erro ao atualizar produto' });
  }
});

// Inicialização do servidor
app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
});

// POST novo produto
app.post('/api/produtos', async (req, res) => {
  const { nome, descricao, preco, imagens, categoria, loja, link } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO produtos (nome, descricao, preco, imagens, categoria, loja, link) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [nome, descricao, preco, imagens, categoria, loja, link]
    );
    io.emit('novoProduto');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar produto' });
  }
});

// PUT atualizar produto
app.put('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, preco, imagens, categoria, loja, link } = req.body;
  try {
    const result = await pool.query(
      'UPDATE produtos SET nome=$1, descricao=$2, preco=$3, imagens=$4, categoria=$5, loja=$6, link=$7 WHERE id=$8 RETURNING *',
      [nome, descricao, preco, imagens, categoria, loja, link, id]
    );
    io.emit('produtoAtualizado');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
});

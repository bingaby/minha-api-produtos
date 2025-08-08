const PLANILHA_ID = '1cQOP4Tpu-9lq1aG6FPNFTmO4C1E1WixGKlMXx_ybzR0';
const ABA = 'Produtos';  // Nome da aba corrigido

fetch(`https://opensheet.vercel.app/${PLANILHA_ID}/${ABA}`)
  .then(res => {
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return res.json();
  })
  .then(data => {
    console.log("Resposta da planilha:", data);
    if (!Array.isArray(data)) 
      throw new Error("Os dados retornados não são um array");

    const hoje = new Date();
    const container = document.getElementById('cupons-container');
    container.innerHTML = '';

    let ativado = 0;
    data.forEach(item => {
      const validade = new Date(item.validade);
      if (validade >= hoje) {
        ativado++;
        const div = document.createElement('div');
        div.className = 'cupom';
        div.innerHTML = `
          <strong>${item.nome} (${item.loja})</strong><br/>
          Código: <code>${item.codigo}</code><br/>
          Válido até: ${item.validade}<br/>
          <a href="${item.link}" target="_blank" rel="noopener">Usar cupom</a>
        `;
        container.appendChild(div);
      }
    });

    if (ativado === 0) {
      container.innerHTML = '<p>Não há cupons válidos no momento.</p>';
    }
  })
  .catch(err => {
    console.error('Erro ao carregar cupons:', err);
    document.getElementById('cupons-container').innerHTML = '<p>Erro ao carregar cupons.</p>';
  });

const API_BASE_URL = 'https://minha-api-produtos.onrender.com';
const socket = io(API_BASE_URL);
let currentPage = 1;

document.addEventListener('DOMContentLoaded', () => {
  // Manipulador de erro para imagens
  document.querySelectorAll('img').forEach(img => {
    img.onerror = () => {
      console.log(`Erro ao carregar imagem: ${img.src}`);
      img.src = '/imagens/placeholder.jpg';
    };
  });

  // Clique triplo no logo
  const logo = document.getElementById('site-logo');
  if (!logo) {
    console.error("Elemento com ID 'site-logo' não encontrado");
  } else {
    let clickCount = 0, clickTimeout = null;
    logo.addEventListener('click', (e) => {
      console.log('Clique no logo:', clickCount + 1);
      e.stopPropagation();
      clickCount++;
      if (clickCount === 1) {
        clickTimeout = setTimeout(() => { clickCount = 0; }, 1000);
      } else if (clickCount === 3) {
        console.log('Tentando redirecionar para admin-xyz-123.html');
        clearTimeout(clickTimeout);
        window.location.href = '/admin-xyz-123.html';
        clickCount = 0;
      }
    });
  }

  // Atualizar ano no footer
  document.getElementById('year').textContent = new Date().getFullYear();

  // Carregar produtos
  async function carregarProdutos(page = 1) {
    const categoria = document.querySelector('.categoria-item.ativa')?.dataset.categoria || 'todas';
    const loja = document.querySelector('.loja.ativa, .loja-todas.ativa')?.dataset.loja || 'todas';
    const busca = document.getElementById('busca').value;
    const url = `${API_BASE_URL}/api/produtos?page=${page}&limit=12` +
                `${categoria !== 'todas' ? `&categoria=${categoria}` : ''}` +
                `${loja !== 'todas' ? `&loja=${loja}` : ''}` +
                `${busca ? `&busca=${encodeURIComponent(busca)}` : ''}`;

    const spinner = document.getElementById('loading-spinner');
    const gridProdutos = document.getElementById('grid-produtos');
    const mensagemVazia = document.getElementById('mensagem-vazia');
    const errorMessage = document.getElementById('error-message');

    spinner.style.display = 'block';
    gridProdutos.innerHTML = '';
    mensagemVazia.style.display = 'none';
    errorMessage.style.display = 'none';

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}`);
      }
      const { data, total } = await response.json();

      if (data.length === 0) {
        mensagemVazia.style.display = 'block';
      } else {
        data.forEach(produto => {
          const div = document.createElement('div');
          div.className = 'produto-card';
          div.innerHTML = `
            <img src="${produto.imagens[0]}" alt="${produto.nome}" loading="lazy">
            <span>${produto.nome}</span>
            <span class="descricao">${produto.descricao || 'Sem descrição'}</span>
            <span class="preco">R$ ${parseFloat(produto.preco).toFixed(2)}</span>
            <a href="${produto.link}" target="_blank" class="ver-na-loja">Ver na Loja</a>
          `;
          div.addEventListener('click', () => openModal(produto.imagens));
          gridProdutos.appendChild(div);
        });
      }

      // Paginação
      const totalPages = Math.ceil(total / 12);
      document.getElementById('page-info').textContent = `Página ${page}`;
      document.getElementById('prev-page').disabled = page === 1;
      document.getElementById('next-page').disabled = page === totalPages;
      document.getElementById('prev-page').onclick = () => carregarProdutos(page - 1);
      document.getElementById('next-page').onclick = () => carregarProdutos(page + 1);
      currentPage = page;
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
      errorMessage.textContent = 'Erro ao carregar produtos';
      errorMessage.style.display = 'block';
    } finally {
      spinner.style.display = 'none';
    }
  }

  // Filtrar por categoria
  window.filtrarPorCategoria = function(categoria) {
    document.querySelectorAll('.categoria-item').forEach(item => {
      item.classList.toggle('ativa', item.dataset.categoria === categoria);
    });
    carregarProdutos(1);
  };

  // Filtrar por loja
  window.filtrarPorLoja = function(loja) {
    document.querySelectorAll('.loja, .loja-todas').forEach(item => {
      item.classList.toggle('ativa', item.dataset.loja === loja);
    });
    carregarProdutos(1);
  };

  // Busca
  document.getElementById('busca').addEventListener('input', () => {
    carregarProdutos(1);
  });

  // Modal e carrossel
  let currentImageIndex = 0;
  window.openModal = function(images) {
    const modal = document.getElementById('imageModal');
    const carrosselImagens = document.getElementById('modalCarrosselImagens');
    const carrosselDots = document.getElementById('modalCarrosselDots');
    
    carrosselImagens.innerHTML = '';
    carrosselDots.innerHTML = '';
    images.forEach((img, index) => {
      const imgElement = document.createElement('img');
      imgElement.src = img;
      imgElement.className = 'modal-image';
      imgElement.style.display = index === 0 ? 'block' : 'none';
      carrosselImagens.appendChild(imgElement);

      const dot = document.createElement('div');
      dot.className = 'carrossel-dot';
      dot.classList.toggle('ativa', index === 0);
      dot.onclick = () => {
        currentImageIndex = index;
        updateCarrossel();
      };
      carrosselDots.appendChild(dot);
    });

    modal.style.display = 'flex';
    currentImageIndex = 0;
  };

  window.closeModal = function() {
    document.getElementById('imageModal').style.display = 'none';
  };

  window.moveModalCarrossel = function(direction) {
    const images = document.querySelectorAll('.modal-image');
    currentImageIndex = (currentImageIndex + direction + images.length) % images.length;
    updateCarrossel();
  };

  function updateCarrossel() {
    document.querySelectorAll('.modal-image').forEach((img, index) => {
      img.style.display = index === currentImageIndex ? 'block' : 'none';
    });
    document.querySelectorAll('.carrossel-dot').forEach((dot, index) => {
      dot.classList.toggle('ativa', index === currentImageIndex);
    });
  }

  // Eventos Socket.IO
  socket.on('novoProduto', () => carregarProdutos(currentPage));
  socket.on('produtoAtualizado', () => carregarProdutos(currentPage));
  socket.on('produtoExcluido', () => carregarProdutos(currentPage));

  // Carregar produtos iniciais
  carregarProdutos();
});

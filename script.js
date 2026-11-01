const progressBar = document.querySelector('#progressBar');
const chapterLinks = [...document.querySelectorAll('.chapter-link')];
const sections = chapterLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
const sidebar = document.querySelector('#chapterNav');
const menuButton = document.querySelector('#menuButton');

function setChapterMenuOpen(open) {
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.querySelector('span').textContent = open ? '−' : '＋';
  sidebar.classList.toggle('open', open);
}

function updateReadingPosition() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  progressBar.style.width = `${scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0}%`;
  let current = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= 150) current = section;
  }
  chapterLinks.forEach(link => {
    const active = current && link.getAttribute('href') === `#${current.id}`;
    link.classList.toggle('active', Boolean(active));
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

window.addEventListener('scroll', updateReadingPosition, { passive: true });
window.addEventListener('resize', updateReadingPosition);
updateReadingPosition();

menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  setChapterMenuOpen(open);
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !sidebar.classList.contains('open')) return;
  setChapterMenuOpen(false);
  menuButton.focus();
});

chapterLinks.forEach(link => link.addEventListener('click', () => {
  if (window.matchMedia('(max-width: 760px)').matches) {
    setChapterMenuOpen(false);
  }
}));

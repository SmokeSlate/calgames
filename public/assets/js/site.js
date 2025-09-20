(() => {
  const navToggle = document.querySelector('.nav-toggle');
  const siteNav = document.querySelector('.site-nav');

  if (navToggle && siteNav) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', (!expanded).toString());
      siteNav.classList.toggle('is-open', !expanded);
      document.body.classList.toggle('nav-open', !expanded);
    });
  }

  if (siteNav) {
    const navLinks = siteNav.querySelectorAll('a[data-nav]');
    const rawPath = window.location.pathname.replace(/index\.html$/, '');
    const normalizedPath = rawPath.endsWith('/') ? rawPath : `${rawPath}/`;

    navLinks.forEach(link => {
      const target = link.dataset.nav || link.getAttribute('href') || '';
      const normalizedTarget = target.endsWith('/') ? target : `${target}/`;

      const isRoot = normalizedTarget === '/' || normalizedTarget === './';
      const matchesRoot = isRoot && (normalizedPath === '/' || normalizedPath === './' || normalizedPath === '');
      const matchesPath = !isRoot && normalizedPath.startsWith(normalizedTarget);

      if (matchesRoot || matchesPath) {
        link.classList.add('is-active');
      }

      link.addEventListener('click', () => {
        if (navToggle && navToggle.getAttribute('aria-expanded') === 'true') {
          navToggle.click();
        }
      });
    });
  }

  const revealOnScroll = () => {
    const elements = document.querySelectorAll('.js-reveal');
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    elements.forEach(element => {
      if (element.classList.contains('is-visible')) {
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.top <= windowHeight - 80) {
        element.classList.add('is-visible');
      }
    });
  };

  window.addEventListener('scroll', revealOnScroll, { passive: true });
  window.addEventListener('load', revealOnScroll);

  const mutationObserver = new MutationObserver(mutations => {
    let shouldReveal = false;

    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) {
          return;
        }

        if (node.classList.contains('js-reveal')) {
          shouldReveal = true;
          return;
        }

        if (node.querySelector && node.querySelector('.js-reveal')) {
          shouldReveal = true;
        }
      });
    });

    if (shouldReveal) {
      requestAnimationFrame(revealOnScroll);
    }
  });

  mutationObserver.observe(document.body, { childList: true, subtree: true });

  const collapsibleButtons = document.querySelectorAll('.collapsible');
  collapsibleButtons.forEach(button => {
    const content = button.nextElementSibling;
    if (!content) {
      return;
    }

    const setMaxHeight = isOpen => {
      if (isOpen) {
        content.classList.add('is-open');
        button.classList.add('is-open');
        content.style.maxHeight = `${content.scrollHeight}px`;
      } else {
        content.classList.remove('is-open');
        button.classList.remove('is-open');
        content.style.maxHeight = null;
      }
    };

    button.addEventListener('click', () => {
      const isOpen = !button.classList.contains('is-open');
      setMaxHeight(isOpen);
    });

    if (content.classList.contains('is-open')) {
      setMaxHeight(true);
    }
  });
})();

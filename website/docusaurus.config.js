const path = require('path');

module.exports = {
  title: 'RadiantScript',
  tagline: 'Smart contracts for Radiant Blockchain',
  url: 'https://radiantcore.org',
  baseUrl: '/',
  favicon: 'img/favicon.ico',
  organizationName: 'Radiant-Core',
  projectName: 'RadiantScript',
  themeConfig: {
    prism: {
      theme: require('prism-react-renderer/themes/nightOwlLight'),
      darkTheme: require('prism-react-renderer/themes/nightOwl'),
      additionalLanguages: ['solidity', 'antlr4'],
    },
    image: 'img/logo.svg',
    navbar: {
      logo: {
        alt: 'RadiantScript',
        src: 'img/logo.svg',
      },
      links: [
        {to: '/docs/basics/about', label: 'Docs', position: 'right'},
        {
          href: 'https://github.com/Radiant-Core/RadiantScript',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/basics/getting-started',
            },
            {
              label: 'Examples',
              to: '/docs/language/examples',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord',
              href: 'https://discord.gg/radiantblockchain',
            },
            {
              label: 'Showcase',
              to: '/docs/showcase',
            },
          ],
        },
        {
          title: 'Resources',
          items: [
            {
              label: 'Radiant Core',
              href: 'https://github.com/Radiant-Core/radiant-node',
            },
            {
              label: 'rxdeb Debugger',
              href: 'https://github.com/Radiant-Core/rxdeb',
            },
          ],
        },
      ],
      copyright: `RadiantScript - Smart contracts for Radiant Blockchain`,
    },
    googleAnalytics: {
      trackingID: 'UA-26805430-6',
    },
    algolia: {
      apiKey: '',
      indexName: 'radiantscript',
    },
  },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl:
            'https://github.com/Radiant-Core/RadiantScript/edit/main/website/',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
  plugins: [
    [
      '@docusaurus/plugin-client-redirects',
      {
        fromExtensions: ['html'],
        redirects: [
          { from: ['/docs', '/docs/about', '/docs/basics'], to: '/docs/basics/about'},
          { from: '/docs/language', to: '/docs/language/contracts' },
          { from: '/docs/sdk', to: '/docs/sdk/instantiation' },
          { from: '/docs/guides', to: '/docs/guides/covenants' },
          { from: '/docs/getting-started', to: '/docs/basics/getting-started' },
          { from: '/docs/examples', to: '/docs/language/examples' },
        ],
      },
    ],
  ],
};

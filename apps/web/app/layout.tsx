import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import { BrandExperience } from '@/components/brand/brand-experience';
import { ThemeProvider } from '@/components/theme/theme-provider';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Painel Gerencial Grupo ABE',
  description:
    'Portal único, seguro e multiempresa que consolida toda a régua de cobrança do Grupo ABE em uma só visão.',
  icons: {
    icon: [
      { url: '/brand/favicon.ico', sizes: 'any' },
      { url: '/brand/icon.png', type: 'image/png' },
    ],
    shortcut: '/brand/favicon.ico',
    apple: '/brand/icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0f1e' },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') ?? '';
  const isLoginRoute =
    headersList.get('x-login-route') === '1' ||
    cookieStore.get('login-route')?.value === '1' ||
    pathname === '/login' ||
    pathname.startsWith('/login/');

  const savedTheme = cookieStore.get('theme')?.value;
  const theme =
    savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : isLoginRoute ? 'dark' : 'light';

  return (
    <html
      lang="pt-BR"
      data-scroll-behavior="smooth"
      {...(isLoginRoute ? { 'data-login': '' } : {})}
      className={`${inter.variable} ${sora.variable} ${theme === 'dark' ? 'dark' : ''}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider initialTheme={theme}>
          {children}
          <BrandExperience />
        </ThemeProvider>
      </body>
    </html>
  );
}

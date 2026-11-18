'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { login, adminHomePath } from '@/lib/auth';
import { toApiError } from '@/lib/api-client';
import { Logo } from '@/components/brand/logo';
import { GlassLoginPanel } from '@/components/login/glass-login-panel';

const DESTAQUES = [
  'Visão 360º da régua de cobrança',
  'Busca unificada por CPF/CNPJ',
  'Isolamento total entre credores',
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const user = await login(email, senha);
      router.push(adminHomePath(user));
    } catch (err) {
      setErro(toApiError(err).title);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      {/* Foto fixa em tela cheia */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-[url('/backgrounds/woman-background-login.png')] bg-cover bg-[left_center] bg-no-repeat"
      />

      {/* Vinheta única — escurece só à esquerda e some antes do meio (junção sem corte) */}
      <div aria-hidden className="login-scrim pointer-events-none fixed inset-0 z-[1]" />

      <main className="relative z-10 grid min-h-screen bg-transparent lg:grid-cols-2">
        {/* ============ PAINEL DA MARCA (esquerda) ============ */}
        <aside className="relative hidden overflow-hidden lg:flex lg:flex-col">
          <div className="relative z-10 flex h-full flex-col justify-between p-12">
            <div aria-hidden className="h-10" />

            <div className="max-w-md">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
                <Sparkles className="h-4 w-4" />
                Painel Gerencial Grupo ABE
              </span>
              <h1 className="mt-6 font-display text-4xl font-bold leading-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
                A cobrança do Grupo ABE, consolidada em uma só visão.
              </h1>
              <ul className="mt-8 space-y-3">
                {DESTAQUES.map((d) => (
                  <li key={d} className="flex items-center gap-3 text-white/90">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-sm text-white/70" suppressHydrationWarning>
              © {new Date().getFullYear()} Grupo ABE · Acesso monitorado e auditado
            </p>
          </div>
        </aside>

        {/* ============ FORMULÁRIO (direita) — sem overlay, foto pura atrás ============ */}
        <section className="relative flex min-h-screen flex-col bg-transparent">
          <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-12">
            <GlassLoginPanel>
              <div className="mb-6 flex justify-center">
                <Logo href="/login" height={220} />
              </div>

              <div className="mb-8 text-center">
                <h2 className="login-glass-title font-display text-3xl font-bold tracking-tight">
                  Bem-vindo de volta
                </h2>
                <p className="login-glass-subtitle mt-2">
                  Entre com suas credenciais para acessar o painel.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <Field
                  id="email"
                  label="E-mail"
                  icon={Mail}
                  type="email"
                  autoComplete="email"
                  placeholder="voce@grupoabe.com.br"
                  value={email}
                  onChange={setEmail}
                />

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="senha" className="login-glass-label text-sm font-medium">
                      Senha
                    </label>
                    <a
                      href="#"
                      className="login-glass-link text-xs font-medium transition-opacity hover:opacity-80"
                    >
                      Esqueceu a senha?
                    </a>
                  </div>
                  <div className="group relative">
                    <Lock className="login-glass-icon pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 transition-colors" />
                    <input
                      id="senha"
                      type={mostrarSenha ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="login-glass-input w-full rounded-xl border border-white/[0.08] bg-transparent px-11 py-3 shadow-none outline-none transition-all duration-200 focus:border-white/25 focus:ring-2 focus:ring-white/[0.06]"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha((v) => !v)}
                      aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                      className="login-glass-eye absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg transition-colors"
                    >
                      {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {erro && (
                  <p
                    role="alert"
                    className="flex animate-fade-in items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
                  >
                    {erro}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={carregando}
                  className="login-glass-submit sheen group flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-semibold shadow-soft transition-all duration-300 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {carregando ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Entrando…
                    </>
                  ) : (
                    <>
                      Entrar no painel
                      <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>

              <p className="login-glass-footnote mt-8 flex items-center justify-center gap-2 text-center text-xs">
                <Lock className="h-3.5 w-3.5" />
                Conexão segura. O uso é monitorado e auditado.
              </p>
            </GlassLoginPanel>
          </div>
        </section>
      </main>
    </>
  );
}

function Field({
  id,
  label,
  icon: Icon,
  type,
  autoComplete,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  type: string;
  autoComplete: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="login-glass-label mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="group relative">
        <Icon className="login-glass-icon pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 transition-colors" />
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="login-glass-input w-full rounded-xl border border-white/[0.08] bg-transparent px-11 py-3 shadow-none outline-none transition-all duration-200 focus:border-white/25 focus:ring-2 focus:ring-white/[0.06]"
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

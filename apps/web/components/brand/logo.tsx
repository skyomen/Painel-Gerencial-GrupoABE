import Image from 'next/image';
import Link from 'next/link';
import logoGrupoAbe from '@/public/brand/GRUPOABE.png';

export function Logo({
  href = '/',
  className = '',
  height = 36,
  priority = false,
}: {
  href?: string | null;
  className?: string;
  /** Altura em px (largura proporcional, definida pelo arquivo). */
  height?: number;
  priority?: boolean;
}) {
  const content = (
    <span className={`group inline-flex items-center ${className}`}>
      <Image
        src={logoGrupoAbe}
        alt="Grupo ABE"
        priority={priority}
        className="w-auto object-contain object-left transition-transform duration-500 ease-spring group-hover:scale-[1.03]"
        style={{ height: `${height}px`, width: 'auto', maxWidth: 'min(220px, 55vw)' }}
      />
    </span>
  );

  if (href) {
    return (
      <Link href={href} aria-label="Painel Gerencial Grupo ABE">
        {content}
      </Link>
    );
  }
  return content;
}

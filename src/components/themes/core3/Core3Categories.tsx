import Link from "next/link";
import Image from "next/image";
import type { Core3Category } from "@/themes/core3/ui";
import { Core3Icon } from "./icons";

/** Os cartões das categorias da página inicial: foto, nome e seta; cada um abre a sua página de stock. */
export function Core3Categories({ categories }: { categories: Core3Category[] }) {
  if (!categories.length) return null;
  const cols = categories.length >= 3 ? "grid-cols-3" : categories.length === 2 ? "grid-cols-2" : "grid-cols-1";
  return (
    <nav aria-label="Categorias" className={`container-px mt-7 grid gap-3 md:mt-6 md:gap-5 ${cols}`}>
      {categories.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          className="group relative block h-[5.5rem] overflow-hidden rounded-xl border border-white/10 sm:h-32 md:h-[10.5rem]"
        >
          <Image
            src={c.photo}
            alt=""
            fill
            sizes="(max-width: 768px) 33vw, 30vw"
            className={`object-cover ${c.photoPosition} transition-transform duration-500 group-hover:scale-105`}
          />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent" />
          <span className="relative flex h-full flex-col justify-end gap-1.5 p-3 md:justify-center md:gap-3 md:px-8">
            <span className="core2-serif text-lg leading-none text-white drop-shadow md:text-[2.2rem]">
              <span className="md:hidden">{c.short}</span>
              <span className="hidden md:inline">{c.label}</span>
            </span>
            <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-accent text-white md:h-8 md:w-8">
              <Core3Icon name="arrow" className="h-3.5 w-3.5 md:h-4 md:w-4" />
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

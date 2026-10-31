"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { homeContentSchema, type HomeContentValues } from "@/lib/schemas";
import { DEFAULT_HOME_CONTENT } from "@/lib/home-content";
import { saveHomeContent } from "@/lib/actions/content";

export function HomeContentForm({ initial }: { initial: HomeContentValues }) {
  const router = useRouter();
  const [brands, setBrands] = useState<string[]>(initial.brands);
  const [brandInput, setBrandInput] = useState("");

  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<HomeContentValues>({
    resolver: zodResolver(homeContentSchema),
    defaultValues: initial,
  });

  const pillars = useFieldArray({ control, name: "trust.pillars" });

  function addBrand() {
    const v = brandInput.trim();
    if (!v) return;
    const next = [...new Set([...brands, v])];
    setBrands(next);
    setValue("brands", next);
    setBrandInput("");
  }
  function removeBrand(v: string) {
    const next = brands.filter((b) => b !== v);
    setBrands(next);
    setValue("brands", next);
  }

  async function onSubmit(values: HomeContentValues) {
    const res = await saveHomeContent({ ...values, brands });
    if (res.ok) {
      toast.success("Página inicial atualizada.");
      router.refresh();
    } else {
      toast.error(res.error ?? "Não foi possível guardar.");
    }
  }

  function resetToDefault() {
    if (!confirm("Repor todos os textos originais do site?")) return;
    reset(DEFAULT_HOME_CONTENT);
    setBrands(DEFAULT_HOME_CONTENT.brands);
    toast.message("Textos originais repostos — grave para confirmar.");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* HERO */}
      <Section title="Destaque (topo) — carros">
        <div className="space-y-4">
          <Field label="Etiqueta (eyebrow)" error={errors.hero?.eyebrow?.message}>
            <input className="field" {...register("hero.eyebrow")} />
          </Field>
          <Field label="Título" error={errors.hero?.title?.message}>
            <input className="field" {...register("hero.title")} />
          </Field>
          <Field label="Subtítulo" error={errors.hero?.subtitle?.message}>
            <textarea rows={2} className="field" {...register("hero.subtitle")} />
          </Field>
          <Field
            label="Fundo do topo (vídeo ou imagem)"
            error={errors.hero?.media?.message}
          >
            <select className="field" {...register("hero.media")}>
              <option value="auto">
                Automático (deteta o ficheiro em public/media/carros/)
              </option>
              <option value="video">Vídeo (public/media/carros/topo.mp4)</option>
              <option value="image">
                Imagem (public/media/carros/topo.jpg)
              </option>
            </select>
            <p className="mt-1.5 text-xs text-paper/50">
              Coloque o ficheiro na pasta <code>public/media/carros/</code>: vídeo em{" "}
              <code>topo.mp4</code> ou imagem em <code>topo.jpg</code> (também
              aceita png/webp/avif). &quot;Automático&quot; escolhe o vídeo se
              existir, senão a imagem. As motas usam sempre o ficheiro que
              estiver em <code>public/media/motas/</code>.
            </p>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Botão 1 — texto">
              <input className="field" {...register("hero.primaryCta.label")} />
            </Field>
            <Field label="Botão 1 — link">
              <input className="field" {...register("hero.primaryCta.href")} />
            </Field>
            <Field label="Botão 2 — texto">
              <input className="field" {...register("hero.secondaryCta.label")} />
            </Field>
            <Field label="Botão 2 — link">
              <input className="field" {...register("hero.secondaryCta.href")} />
            </Field>
          </div>
        </div>
      </Section>

      {/* HERO DAS MOTAS */}
      <Section title="Destaque (topo) — motas">
        <div className="space-y-4">
          <p className="text-xs text-paper/50">
            O que aparece no topo da página inicial quando o visitante está nas motas.
          </p>
          <Field label="Etiqueta (eyebrow)" error={errors.motoHero?.eyebrow?.message}>
            <input className="field" {...register("motoHero.eyebrow")} />
          </Field>
          <Field label="Título" error={errors.motoHero?.title?.message}>
            <input className="field" {...register("motoHero.title")} />
          </Field>
          <Field label="Subtítulo" error={errors.motoHero?.subtitle?.message}>
            <textarea rows={2} className="field" {...register("motoHero.subtitle")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Botão — texto">
              <input className="field" {...register("motoHero.primaryCta.label")} />
            </Field>
            <Field label="Botão — link">
              <input className="field" {...register("motoHero.primaryCta.href")} />
            </Field>
          </div>
        </div>
      </Section>

      {/* MARCAS */}
      <Section title="Faixa de marcas">
        <span className="field-label">Marcas (deslizam no topo)</span>
        <div className="flex gap-2">
          <input
            value={brandInput}
            onChange={(e) => setBrandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addBrand();
              }
            }}
            placeholder="Ex.: BMW. Enter para adicionar"
            className="field flex-1"
          />
          <button type="button" onClick={addBrand} className="btn-ghost px-4">
            Adicionar
          </button>
        </div>
        {brands.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {brands.map((b) => (
              <li
                key={b}
                className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-paper"
              >
                {b}
                <button
                  type="button"
                  onClick={() => removeBrand(b)}
                  aria-label={`Remover ${b}`}
                  className="text-paper/50 hover:text-red-300"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* CONFIANÇA */}
      <Section title="Secção de confiança">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Etiqueta">
              <input className="field" {...register("trust.eyebrow")} />
            </Field>
            <Field label="Título (use Enter para nova linha)">
              <textarea rows={2} className="field" {...register("trust.title")} />
            </Field>
          </div>

          <div className="space-y-3">
            <span className="field-label">Pilares</span>
            {pillars.fields.map((f, i) => (
              <div
                key={f.id}
                className="grid gap-3 rounded-xl border border-white/10 p-3 sm:grid-cols-[100px_1fr]"
              >
                <input
                  className="field"
                  placeholder="150+"
                  {...register(`trust.pillars.${i}.kpi` as const)}
                />
                <div className="space-y-2">
                  <input
                    className="field"
                    placeholder="Título do pilar"
                    {...register(`trust.pillars.${i}.title` as const)}
                  />
                  <textarea
                    rows={2}
                    className="field"
                    placeholder="Descrição"
                    {...register(`trust.pillars.${i}.body` as const)}
                  />
                  <button
                    type="button"
                    onClick={() => pillars.remove(i)}
                    className="text-xs text-red-400/70 hover:text-red-300"
                  >
                    Remover pilar
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                pillars.append({ kpi: "", title: "", body: "" })
              }
              className="btn-ghost px-4"
            >
              ＋ Adicionar pilar
            </button>
          </div>
        </div>
      </Section>

      {/* CTA FINAL */}
      <Section title="Chamada final (contacto)">
        <div className="space-y-4">
          <Field label="Etiqueta">
            <input className="field" {...register("cta.eyebrow")} />
          </Field>
          <Field label="Título" error={errors.cta?.title?.message}>
            <input className="field" {...register("cta.title")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Botão WhatsApp — texto">
              <input className="field" {...register("cta.whatsappLabel")} />
            </Field>
            <div />
            <Field label="Botão 2 — texto">
              <input className="field" {...register("cta.secondary.label")} />
            </Field>
            <Field label="Botão 2 — link">
              <input className="field" {...register("cta.secondary.href")} />
            </Field>
          </div>
        </div>
      </Section>

      <div className="sticky bottom-0 md:bottom-[4.75rem] -mx-2 flex items-center justify-between gap-3 border-t border-white/10 bg-ink/90 px-2 py-4 backdrop-blur">
        <button type="button" onClick={resetToDefault} className="btn-ghost">
          Repor original
        </button>
        <button type="submit" disabled={isSubmitting} className="btn-primary">
          {isSubmitting ? "A guardar…" : "Guardar alterações"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-paper/50">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="field-label">{label}</span>
      {children}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

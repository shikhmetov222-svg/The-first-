import { useState } from 'react';
import { ArrowLeft, Dices } from 'lucide-react';
import type { Company, CompanyInput } from '../api';
import { LOGO_COLORS, LOGO_ICONS, nameProblem, randomCompanyName } from '../company';
import { haptic } from '../telegram';
import { CompanyLogo } from './CompanyLogo';

const MOTTO_MAX = 40;

interface Props {
  /** Есть — режим «Изменить», нет — создание компании по шагам. */
  initial?: Company;
  busy: boolean;
  error: string | null;
  onSubmit: (company: CompanyInput) => void;
  onCancel?: () => void;
}

export function CompanyForm({ initial, busy, error, onSubmit, onCancel }: Props) {
  const editing = Boolean(initial);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'crown');
  const [color, setColor] = useState(initial?.color ?? 'gold');
  const [motto, setMotto] = useState(initial?.motto ?? '');
  const [touched, setTouched] = useState(false);

  const problem = nameProblem(name);
  const nameLocked = editing && !initial!.can_rename;
  const submit = () => onSubmit({ name: name.trim().replace(/\s+/g, ' '), icon, color, motto: motto.trim() });

  const preview = (
    <div className="company-preview">
      <CompanyLogo icon={icon} color={color} size={64} />
      <div className="grow">
        <div className="company-preview-name">{name.trim() || 'Твоя компания'}</div>
        <div className="stat-label">{motto.trim() || 'Девиз компании'}</div>
      </div>
    </div>
  );

  const nameField = (
    <>
      <label className="field">
        <input
          className="input"
          value={name}
          maxLength={24}
          disabled={nameLocked}
          placeholder="Например, Северный Капитал"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        <span className="field-counter">{name.trim().length}/24</span>
      </label>
      {nameLocked ? (
        <p className="hint small">Название уже меняли в этом сезоне. Новое — в следующем.</p>
      ) : (
        <button
          className="button secondary small"
          onClick={() => {
            haptic('light');
            setName(randomCompanyName());
          }}
        >
          <Dices size={18} /> Случайное название
        </button>
      )}
      {touched && problem && !nameLocked && <p className="warning small">{problem}</p>}
      {editing && initial!.can_rename && (
        <p className="hint small">Название можно сменить только один раз за сезон.</p>
      )}
    </>
  );

  const logoField = (
    <>
      <div className="stat-label">Значок</div>
      <div className="logo-grid">
        {Object.entries(LOGO_ICONS).map(([key, Icon]) => (
          <button
            key={key}
            className={`logo-choice ${icon === key ? 'active' : ''}`}
            aria-label={key}
            aria-pressed={icon === key}
            onClick={() => setIcon(key)}
          >
            <Icon size={24} />
          </button>
        ))}
      </div>
      <div className="stat-label">Цвет</div>
      <div className="color-row">
        {Object.entries(LOGO_COLORS).map(([key, hex]) => (
          <button
            key={key}
            className={`color-choice ${color === key ? 'active' : ''}`}
            style={{ background: hex }}
            aria-label={key}
            aria-pressed={color === key}
            onClick={() => setColor(key)}
          />
        ))}
      </div>
    </>
  );

  const mottoField = (
    <label className="field">
      <input
        className="input"
        value={motto}
        maxLength={MOTTO_MAX}
        placeholder="Например, Всегда на шаг впереди"
        onChange={(e) => setMotto(e.target.value)}
      />
      <span className="field-counter">
        {motto.length}/{MOTTO_MAX}
      </span>
    </label>
  );

  if (editing) {
    return (
      <div className="onboarding">
        <header className="onboarding-head">
          <button className="icon-button" aria-label="Назад" onClick={onCancel}>
            <ArrowLeft size={20} />
          </button>
          <h1>Компания</h1>
        </header>
        {preview}
        <div className="stat-label">Название</div>
        {nameField}
        {logoField}
        <div className="stat-label">Девиз (необязательно)</div>
        {mottoField}
        {error && <p className="warning">{error}</p>}
        <button className="button" disabled={busy || Boolean(problem)} onClick={submit}>
          Сохранить
        </button>
      </div>
    );
  }

  const steps = [
    {
      title: 'Как назовёшь свою компанию?',
      hint: 'Это имя увидят все игроки в рейтинге.',
      body: nameField,
      canNext: !problem,
    },
    {
      title: 'Выбери логотип',
      hint: 'Значок и цвет — лицо твоей компании.',
      body: logoField,
      canNext: true,
    },
    {
      title: 'Девиз компании',
      hint: 'Необязательно. До 40 символов — его увидят соперники.',
      body: mottoField,
      canNext: true,
    },
  ];
  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="onboarding">
      <header className="onboarding-head">
        {step > 0 ? (
          <button className="icon-button" aria-label="Назад" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={20} />
          </button>
        ) : (
          <span className="wordmark">CAPITAL</span>
        )}
        <div className="dots" aria-label={`Шаг ${step + 1} из ${steps.length}`}>
          {steps.map((_, i) => (
            <span key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>
      </header>

      <h1>{current.title}</h1>
      <p className="hint">{current.hint}</p>
      {preview}
      {current.body}
      {error && <p className="warning">{error}</p>}

      <div className="onboarding-footer">
        <button
          className="button"
          disabled={busy || !current.canNext}
          onClick={() => {
            setTouched(true);
            if (!current.canNext) return;
            haptic('light');
            if (last) submit();
            else setStep(step + 1);
          }}
        >
          {last ? (motto.trim() ? 'Основать компанию' : 'Пропустить и основать') : 'Далее'}
        </button>
      </div>
    </div>
  );
}

export default function PreparationProgress({ step }: { step: number }) {
  return <div className="space-y-3">
    <p className="text-sm font-medium text-foreground-600" role="status">{step > 4 ? 'Всички стъпки са завършени' : `Стъпка ${step} от 4`}</p>
    <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Стъпки за присъединяване">
      {['Твоите данни', 'Кратко обучение', 'Документи', 'Одобрение'].map((label, i) => <li key={label} aria-current={step === i + 1 ? 'step' : undefined} className={`flex items-center gap-2 rounded-xl px-3 py-3 border ${step === i + 1 ? 'bg-primary-50 border-primary-200' : 'bg-background-50 border-transparent'}`}>
        <span className={`flex items-center justify-center w-7 h-7 shrink-0 rounded-full text-sm font-semibold ${step > i + 1 ? 'bg-primary-500 text-white' : step === i + 1 ? 'bg-primary-100 text-primary-800' : 'bg-background-200 text-foreground-500'}`} aria-hidden="true">{step > i + 1 ? '✓' : i + 1}</span>
        <span className="text-sm font-medium text-foreground-700">{label}<span className="sr-only">{step > i + 1 ? ' — завършено' : step === i + 1 ? ' — текуща стъпка' : ' — предстои'}</span></span>
      </li>)}
    </ol>
  </div>;
}

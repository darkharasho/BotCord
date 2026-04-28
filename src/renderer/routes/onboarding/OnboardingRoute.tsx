import { useState } from 'react';
import { Step1Application } from './steps/Step1Application';
import { Step2BotUser } from './steps/Step2BotUser';
import { Step3Intents } from './steps/Step3Intents';
import { Step4Invite } from './steps/Step4Invite';
import { Step5Token } from './steps/Step5Token';

const TOTAL = 5;

export function OnboardingRoute() {
  const [step, setStep] = useState(1);
  const next = () => setStep(s => Math.min(TOTAL, s + 1));
  const back = () => setStep(s => Math.max(1, s - 1));

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-bg-subtle border border-border rounded-lg p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-6 text-xs text-fg-muted">
          {Array.from({ length: TOTAL }, (_, i) => i + 1).map(n => (
            <div key={n} className={`flex-1 h-1 rounded ${n <= step ? 'bg-accent' : 'bg-border'}`} />
          ))}
        </div>
        {step === 1 && <Step1Application onNext={next} />}
        {step === 2 && <Step2BotUser onNext={next} onBack={back} />}
        {step === 3 && <Step3Intents onNext={next} onBack={back} />}
        {step === 4 && <Step4Invite onNext={next} onBack={back} />}
        {step === 5 && <Step5Token onBack={back} goToIntents={() => setStep(3)} />}
      </div>
    </div>
  );
}

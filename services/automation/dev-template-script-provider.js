'use strict';

function text(value, max = 1000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function isConfigured() {
  return process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER === '1';
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Cancelled');
      error.code = 'PROVIDER_CANCELLED';
      reject(error);
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('Cancelled');
        error.code = 'PROVIDER_CANCELLED';
        reject(error);
      }, { once: true });
    }
  });
}

function languageCopy(language) {
  if (language === 'en') {
    return {
      titlePrefix: 'Short video: ',
      hook: subject => `If ${subject} matters to you, start with this simple idea.`,
      body: (subject, objective, audience) => [
        `First, make the main point about ${subject} clear in the opening seconds.`,
        objective ? `Keep every beat focused on the objective: ${objective}.` : 'Keep each beat focused on one useful takeaway.',
        audience ? `Use examples and wording that fit ${audience}.` : 'Use concrete examples and natural wording.',
        'Finish with one memorable takeaway instead of adding unnecessary detail.'
      ].join(' '),
      cta: value => value || 'Save this and follow for the next part.'
    };
  }

  if (language === 'ko') {
    return {
      titlePrefix: '숏폼 영상: ',
      hook: subject => `${subject}에 관심이 있다면, 이 한 가지 포인트부터 시작해보세요.`,
      body: (subject, objective, audience) => [
        `첫 몇 초 안에 ${subject}의 핵심을 분명하게 보여줍니다.`,
        objective ? `모든 장면은 목표인 “${objective}”에 집중합니다.` : '각 장면은 하나의 유용한 메시지에 집중합니다.',
        audience ? `${audience}에게 자연스럽게 들리는 예시와 표현을 사용합니다.` : '구체적인 예시와 자연스러운 표현을 사용합니다.',
        '마지막에는 불필요한 설명 대신 기억하기 쉬운 한 문장으로 정리합니다.'
      ].join(' '),
      cta: value => value || '저장해두고 다음 편도 확인해보세요.'
    };
  }

  if (language === 'ja') {
    return {
      titlePrefix: 'ショート動画：',
      hook: subject => `${subject}が気になるなら、まずこのポイントから始めてみてください。`,
      body: (subject, objective, audience) => [
        `最初の数秒で${subject}の要点をはっきり伝えます。`,
        objective ? `各パートは「${objective}」という目的に集中させます。` : '各パートは一つの役立つポイントに集中させます。',
        audience ? `${audience}に合う具体例と言葉を使います。` : '具体例と自然な表現を使います。',
        '最後は情報を増やしすぎず、覚えやすい一言で締めます。'
      ].join(' '),
      cta: value => value || '保存して、次のパートもチェックしてください。'
    };
  }

  return {
    titlePrefix: 'Video ngắn: ',
    hook: subject => `Nếu bạn đang quan tâm đến ${subject}, hãy bắt đầu từ một điểm đơn giản này.`,
    body: (subject, objective, audience) => [
      `Trong vài giây đầu, làm rõ điều quan trọng nhất về ${subject}.`,
      objective ? `Mỗi nhịp nội dung đều bám vào mục tiêu: ${objective}.` : 'Mỗi nhịp chỉ nên tập trung vào một ý hữu ích.',
      audience ? `Dùng ví dụ và cách nói phù hợp với ${audience}.` : 'Dùng ví dụ cụ thể và cách nói tự nhiên.',
      'Kết thúc bằng một ý dễ nhớ thay vì thêm quá nhiều thông tin.'
    ].join(' '),
    cta: value => value || 'Lưu lại và theo dõi để xem phần tiếp theo.'
  };
}

async function generateScript({ brief = {}, signal } = {}) {
  if (!isConfigured()) {
    const error = new Error('Development script provider is disabled.');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const topic = text(brief.topic, 1000);
  const product = text(brief.product, 1000);
  const subject = topic || product;
  if (!subject) {
    const error = new Error('Automation brief requires a topic or product.');
    error.code = 'AUTOMATION_BRIEF_INVALID';
    throw error;
  }

  await wait(280, signal);

  const language = text(brief.language, 32).toLowerCase() || 'vi';
  const copy = languageCopy(language);
  const objective = text(brief.objective, 2000);
  const audience = text(brief.audience, 1000);
  const requestedCta = text(brief.callToAction, 1000);
  const hook = copy.hook(subject);
  const body = copy.body(subject, objective, audience);
  const callToAction = copy.cta(requestedCta);

  return {
    provider: 'dev-template',
    model: 'deterministic-template-v1',
    title: copy.titlePrefix + subject,
    hook,
    body,
    callToAction,
    narrationText: [hook, body, callToAction].filter(Boolean).join('\n\n'),
    meta: {
      developmentPreview: true,
      deterministic: true,
      networkUsed: false
    }
  };
}

module.exports = {
  id: 'dev-template',
  isConfigured,
  generateScript
};

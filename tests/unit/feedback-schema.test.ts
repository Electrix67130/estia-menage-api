import { describe, expect, it } from 'vitest';
import {
  createFeedbackSchema,
  respondFeedbackSchema,
} from '@/modules/feedback/feedback.schema';

describe('createFeedbackSchema', () => {
  const valide = {
    type: 'bug' as const,
    subject: 'Photos absentes',
    message: 'La galerie reste vide depuis ce matin.',
  };

  it('accepte un signalement minimal', () => {
    expect(createFeedbackSchema.parse(valide).type).toBe('bug');
  });

  it('refuse un message trop court pour être exploitable', () => {
    expect(createFeedbackSchema.safeParse({ ...valide, message: 'bug' }).success).toBe(false);
  });

  it('refuse un objet trop court', () => {
    expect(createFeedbackSchema.safeParse({ ...valide, subject: 'ko' }).success).toBe(false);
  });

  it('refuse un type inconnu', () => {
    expect(createFeedbackSchema.safeParse({ ...valide, type: 'question' }).success).toBe(false);
  });

  it('coupe les espaces autour du sujet et du message', () => {
    const out = createFeedbackSchema.parse({ ...valide, subject: '  Photos absentes  ' });
    expect(out.subject).toBe('Photos absentes');
  });

  it('accepte le contexte technique', () => {
    const out = createFeedbackSchema.parse({
      ...valide,
      platform: 'mobile',
      app_version: '0.1.0',
      screen: '/menage/[id]',
      locale: 'en',
    });
    expect(out).toMatchObject({ platform: 'mobile', app_version: '0.1.0', locale: 'en' });
  });
});

describe('respondFeedbackSchema', () => {
  it('accepte un simple changement de statut', () => {
    expect(respondFeedbackSchema.parse({ status: 'in_progress' }).status).toBe('in_progress');
  });

  it('accepte le retrait d’une réponse', () => {
    expect(respondFeedbackSchema.parse({ response: null }).response).toBeNull();
  });

  it('refuse une requête vide, qui ne dirait rien', () => {
    expect(respondFeedbackSchema.safeParse({}).success).toBe(false);
  });
});

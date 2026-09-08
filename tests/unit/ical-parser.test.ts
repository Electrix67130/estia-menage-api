import { describe, expect, it } from 'vitest';
import { isBlockedEvent, isIdLikeSummary, parseIcal } from '@/modules/logement-external-calendar/ical-parser';

const enveloppe = (evenements: string) => `BEGIN:VCALENDAR\nVERSION:2.0\n${evenements}\nEND:VCALENDAR`;

describe('parseIcal', () => {
  it('lit une réservation Airbnb complète', () => {
    const [ev] = parseIcal(
      enveloppe(
        `BEGIN:VEVENT
DTSTART;VALUE=DATE:20260701
DTEND;VALUE=DATE:20260705
SUMMARY:Reserved
UID:abc123@airbnb.com
END:VEVENT`,
      ),
    );
    expect(ev).toMatchObject({ uid: 'abc123@airbnb.com', start_date: '2026-07-01', end_date: '2026-07-05' });
  });

  it('accepte un DTSTART en heure locale, sans Z', () => {
    // Les ré-exports type PassPass écrivent `20260720T180000` : seule la partie
    // date nous intéresse, mais elle doit être lue.
    const [ev] = parseIcal(
      enveloppe(`BEGIN:VEVENT\nDTSTART:20260720T180000\nDTEND:20260723T100000\nUID:x\nEND:VEVENT`),
    );
    expect(ev.start_date).toBe('2026-07-20');
    expect(ev.end_date).toBe('2026-07-23');
  });

  it('recolle les lignes pliées (RFC 5545 §3.1)', () => {
    const [ev] = parseIcal(
      enveloppe(
        `BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260701\nDTEND;VALUE=DATE:20260702\nUID:x\nSUMMARY:Un titre\n  qui continue\nEND:VEVENT`,
      ),
    );
    expect(ev.summary).toBe('Un titre qui continue');
  });

  it('ignore un VEVENT sans dates', () => {
    expect(parseIcal(enveloppe(`BEGIN:VEVENT\nUID:sans-dates\nEND:VEVENT`))).toHaveLength(0);
  });

  describe('UID absent — le cas PassPass/Cozysmart', () => {
    const flux = enveloppe(
      `BEGIN:VEVENT\nSUMMARY:63fcf5b7-0c2e-42f1-b0c1-3cd834bc3aa8\nDTSTART:20260720T180000\nDTEND:20260723T100000\nEND:VEVENT`,
    );

    it("retient l'événement malgré l'absence d'UID", () => {
      // Sans repli, ces réservations étaient silencieusement ignorées : aucun
      // ménage créé, et aucune erreur pour le signaler.
      expect(parseIcal(flux, 'cal-1')).toHaveLength(1);
    });

    it('reprend le SUMMARY comme identifiant quand il en a la forme', () => {
      expect(parseIcal(flux, 'cal-1')[0].uid).toBe('63fcf5b7-0c2e-42f1-b0c1-3cd834bc3aa8');
    });

    it('dérive un identifiant stable quand le SUMMARY est un libellé', () => {
      const lisible = enveloppe(
        `BEGIN:VEVENT\nSUMMARY:Reservation client\nDTSTART:20260720T180000\nDTEND:20260723T100000\nEND:VEVENT`,
      );
      const premier = parseIcal(lisible, 'cal-1')[0].uid;
      const second = parseIcal(lisible, 'cal-1')[0].uid;
      expect(premier).toMatch(/^gen-/);
      // Stable d'une synchro à l'autre, sinon chaque passage recréerait le ménage.
      expect(second).toBe(premier);
    });

    it('distingue deux calendriers identiques', () => {
      const lisible = enveloppe(
        `BEGIN:VEVENT\nSUMMARY:Reservation client\nDTSTART:20260720T180000\nDTEND:20260723T100000\nEND:VEVENT`,
      );
      // La contrainte d'unicité porte sur (external_source, uid, type) : deux
      // calendriers du même provider ne doivent pas se marcher dessus.
      expect(parseIcal(lisible, 'cal-1')[0].uid).not.toBe(parseIcal(lisible, 'cal-2')[0].uid);
    });
  });
});

describe('isBlockedEvent', () => {
  it('considère une indisponibilité sans réservation comme un blocage', () => {
    expect(
      isBlockedEvent({ uid: 'x', start_date: '2026-07-01', end_date: '2026-07-02', summary: 'Airbnb (Not available)' }),
    ).toBe(true);
  });

  it("garde une réservation même libellée « not available » si elle porte une URL", () => {
    expect(
      isBlockedEvent({
        uid: 'x',
        start_date: '2026-07-01',
        end_date: '2026-07-02',
        summary: 'Not available',
        description: 'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABCD',
      }),
    ).toBe(false);
  });

  it('laisse passer un événement sans libellé particulier', () => {
    expect(isBlockedEvent({ uid: 'x', start_date: '2026-07-01', end_date: '2026-07-02', summary: 'Reserved' })).toBe(false);
  });
});

describe('isIdLikeSummary', () => {
  it('reconnaît un identifiant technique', () => {
    expect(isIdLikeSummary('63fcf5b7-0c2e-42f1-b0c1-3cd834bc3aa8')).toBe(true);
  });

  it('rejette un libellé lisible, qui a sa place dans les notes', () => {
    expect(isIdLikeSummary('Reservation client')).toBe(false);
    expect(isIdLikeSummary(undefined)).toBe(false);
  });
});

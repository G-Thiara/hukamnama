# Roadmap

Planned and potential features for gurudahukam.com. Not in strict priority order — reflects current thinking.

---

## In Progress
- [ ] Twitter/X bot — post daily essence automatically

---

## Near Term

### Social
- [ ] Instagram bot — post daily essence with Gurmukhi verse as image
- [ ] WhatsApp broadcast list integration

### Content
- [ ] Historical archive — browse past hukamnamas and their essences
- [ ] Share button — copy essence text or share to WhatsApp/Twitter directly from the page

### Quality
- [ ] Human review mode — flag essences that miss the mark, feed corrections back into prompt
- [ ] A/B test synthesis prompt variations to improve quality over time

---

## Longer Term

### Audio
- [ ] Authentic voice recitation — blocked on finding a scalable, reverent audio source (GurbaniNow has no audio API; YouTube/SikhNet feel off for embedding). Revisit if SGPC opens up their audio.

### Reach
- [ ] Email/SMS daily delivery — subscribe to receive the essence every morning
- [ ] Mobile app (PWA) — add to home screen, push notifications

### Internationalisation
- [ ] Punjabi synthesis — essence written in Punjabi for native speakers
- [ ] Hindi synthesis

---

## Decisions Made (won't revisit unless good reason)

| Decision | Reason |
|----------|--------|
| No audio (for now) | No authentic, scalable source available |
| Plain HTML, no framework | One page, no interactivity — framework adds no value |
| Sonnet for synthesis, Haiku for review | Quality where it matters; cheap for pass/fail |
| GurbaniNow `/today` endpoint | Their IST clock is reliable; date-specific URL breaks before Amrit Vela |
| Redis over in-memory cache | Serverless functions are stateless |

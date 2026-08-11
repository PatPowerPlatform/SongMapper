# Song Mapper v3.1

## Najważniejszy workflow
1. Dodaj audio do Song Mapper.
2. Aplikacja wykona wstępną analizę lokalną.
3. Kliknij **Pobierz prompt dla ChatGPT**.
4. W aplikacji ChatGPT utwórz nową rozmowę i dodaj:
   - wygenerowany plik `*-CHATGPT-INSTRUCTIONS.txt`
   - ten sam plik audio.
5. Wyślij wiadomość z krótkim poleceniem: `Wykonaj instrukcję z załączonego pliku.`
6. ChatGPT powinien zwrócić gotowy plik `*.songmap.json`.
7. Pobierz go na iPhone.
8. W Song Mapper kliknij **Importuj mapę z ChatGPT** i wybierz pobrany plik.
9. Sprawdź podgląd oraz wybierz tryb importu.

## v3
- import/eksport `.songmap.json`
- walidacja mapy przed importem
- lokalny analyzer jako fallback
- timeline struktury
- SHOW CUES: DROP, BUILD, BREAKDOWN, HIT, BLACKOUT, ACCENT, VOCAL IN/OUT, CUSTOM
- ręczne cue pointy
- cue point na bieżącym czasie
- sekcje: Intro, Verse, Pre-Chorus, Chorus, Bridge, Break, Instrumental, Outro
- notatki do sekcji
- lokalna biblioteka IndexedDB
- BPM, waveform, loop, korekta pętli, playback speed
- backup mapy do JSON

## Aktualizacja z v2
Wgraj pliki v3 do tego samego repozytorium GitHub Pages, zastępując stare pliki. Service worker ma nową wersję cache. Po wejściu na stronę w Safari zamknij i ponownie otwórz aplikację z ekranu głównego. Jeżeli nadal widzisz v2, usuń web-app z ekranu głównego i dodaj ją ponownie.

Audio nie jest wysyłane automatycznie do żadnej usługi. Użytkownik sam dołącza audio w ChatGPT.


## Enhanced Local Analysis v3.1

Lokalny analizator został przebudowany. Zamiast opierać strukturę głównie na energii i podobieństwie widma, wersja 3.1 wykorzystuje:

- dokładniejszą obwiednię onset/transient do estymacji BPM,
- automatyczny beat grid i próbę ustalenia fazy taktów,
- 12-wymiarową chromę (pitch-class profile) do śledzenia harmonii,
- osobne cechy barwy/tekstury,
- reprezentację utworu na poziomie taktów,
- self-similarity matrix całego utworu,
- checkerboard novelty do wykrywania granic strukturalnych,
- priorytet fraz 4/8/16-taktowych,
- porównywanie całych wzorców sekcji zamiast wyłącznie ich średniej energii,
- rozpoznawanie Chorus głównie z powtarzalności motywu,
- Pre-Chorus z pozycji przed powtarzającym się Chorus i zmiany harmonicznej,
- Bridge jako unikalnego fragmentu w późniejszej części utworu.

Wszystko nadal działa lokalnie, bez zewnętrznego API.

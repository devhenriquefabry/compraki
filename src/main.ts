import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { prepareFirebase } from './app/core/emulator-bootstrap';

import { register } from 'swiper/element/bundle';

register();

// No build normal `prepareFirebase` não faz nada; no build `emulator` liga os
// emuladores e o login de teste antes de qualquer service tocar no Firebase.
prepareFirebase()
  .then(() => platformBrowserDynamic().bootstrapModule(AppModule))
  .catch(err => console.log(err));

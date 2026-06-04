import 'dotenv/config';
import { sendVerificationCode } from '../services/authService';

async function main() {
  const email = process.argv[2] || 'iavila@iea.com.ar';
  console.log(`Testing sendVerificationCode for: ${email}`);
  try {
    await sendVerificationCode(email);
    console.log('sendVerificationCode finished. Check console logs or your mailbox.');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

main();

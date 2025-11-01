This repository has a user access system to allow production level changes to only affect users who have opted in, or granted a special role. This file will explain some examples of features I may ask you to implement, along with which access level should be allowed that. In the event I specify which roles should have access in my prompt, you can ignore this. If a situation is not covered, use your best guess based on the information provided, but if you're really not sure, lean conservatively (restrict more to be safe)

| Example Request | Who can access | Reason |
|-----------|-----------|-----------|
| A database structure adjustment    | All users    | Limiting this to some users could lead to unforseen issues    |
| A simple UI change    | All users    | A simple UI change is extremely unlikely to break anything    |
| A text change    | All users    | A text change won't break the website, so everyone can have it    |
| A new animation style    | Owner & Beta Tester    | While a new animation style is unlikely to break anything, standard users could get frustraded with it if it's not polised    |
| A bug fix    | All Users    | A bug fix should be given to all users, especailly sense standard users need the most polished experience    |
| A large scale javascript simplification    | Only Owner    | A large scale javascript simplification is likely to cause issues, and it doesn't add any new features, so the the beta testers won't feel like they're missing out    |
| The removal of an unused feature    | All users    | Removing a feature probably won't cause any issues so it can apply to everyone    |
| A new banner message at the top of the page    | All users    | A banner message is likely announcing import info, so all users should no right away    |
| A brand new major feautre thats likely to have issues    | Owner & Beta Tester    | I as the owner needs to test it, and beta users will be excited to try new major features, even if it's not fully polised.    |
| A brand new major feautre thats unlikely to have issues   | Owner, Beta Tester, Special Access   | Similar to the row above, although special Access users can try it sense it's unlikely to have issues. Standard users can't have access, as it's still brand new and experimental.   |

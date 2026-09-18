// The keyword glossary, generated from the Android app's data/rules/Keywords.kt so both apps
// explain every keyword the same way. The most-referenced gameplay keywords and actions, not every
// set-specific mechanic; card-specific interactions come from the rulings lookup instead.

export interface Keyword {
  name: string
  category: string
  text: string
}

export const KEYWORDS: Keyword[] = [
  { name: "Deathtouch", category: "Evergreen", text: "Any amount of damage this deals to a creature is enough to destroy it." },
  { name: "Defender", category: "Evergreen", text: "This creature can't attack." },
  { name: "Double strike", category: "Evergreen", text: "This creature deals both first-strike and regular combat damage." },
  { name: "Enchant", category: "Evergreen", text: "This Aura can only be attached to the kind of object or player it specifies." },
  { name: "Equip", category: "Evergreen", text: "Attach this Equipment to target creature you control. Equip only as a sorcery — during your main phase with an empty stack." },
  { name: "First strike", category: "Evergreen", text: "This creature deals its combat damage before creatures without first strike." },
  { name: "Flash", category: "Evergreen", text: "You may cast this spell any time you could cast an instant." },
  { name: "Flying", category: "Evergreen", text: "This creature can't be blocked except by creatures with flying or reach." },
  { name: "Haste", category: "Evergreen", text: "This creature can attack and use its tap abilities the turn it comes under your control." },
  { name: "Hexproof", category: "Evergreen", text: "This permanent can't be the target of spells or abilities your opponents control." },
  { name: "Indestructible", category: "Evergreen", text: "This permanent can't be destroyed by damage or by effects that say \"destroy\"." },
  { name: "Lifelink", category: "Evergreen", text: "Damage dealt by this permanent also causes you to gain that much life." },
  { name: "Menace", category: "Evergreen", text: "This creature can't be blocked except by two or more creatures." },
  { name: "Protection", category: "Evergreen", text: "This can't be Damaged, Enchanted or Equipped, Blocked, or Targeted by anything with the stated quality (remember it as \"DEBT\")." },
  { name: "Reach", category: "Evergreen", text: "This creature can block creatures with flying." },
  { name: "Trample", category: "Evergreen", text: "If this creature would assign enough combat damage to destroy the creatures blocking it, you may assign the rest to the player or planeswalker it's attacking." },
  { name: "Vigilance", category: "Evergreen", text: "Attacking doesn't cause this creature to tap." },
  { name: "Ward", category: "Evergreen", text: "Whenever this becomes the target of a spell or ability an opponent controls, counter it unless that player pays the ward cost." },
  { name: "Prowess", category: "Keyword", text: "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn." },
  { name: "Shroud", category: "Keyword", text: "This permanent can't be the target of any spells or abilities." },
  { name: "Fear", category: "Keyword", text: "This creature can't be blocked except by artifact creatures and/or black creatures." },
  { name: "Intimidate", category: "Keyword", text: "This creature can't be blocked except by artifact creatures and/or creatures that share a color with it." },
  { name: "Infect", category: "Keyword", text: "This deals damage to creatures as -1/-1 counters and to players as poison counters." },
  { name: "Cascade", category: "Keyword", text: "When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast that card without paying its mana cost." },
  { name: "Convoke", category: "Keyword", text: "You may tap any number of untapped creatures as you cast this spell. Each pays for {1} or one mana of that creature's color." },
  { name: "Cycling", category: "Keyword", text: "Pay the cycling cost and discard this card to draw a card." },
  { name: "Flashback", category: "Keyword", text: "You may cast this card from your graveyard for its flashback cost, then exile it." },
  { name: "Kicker", category: "Keyword", text: "You may pay an additional kicker cost as you cast this spell for an added effect." },
  { name: "Morph", category: "Keyword", text: "You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time by paying its morph cost." },
  { name: "Persist", category: "Keyword", text: "When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield with a -1/-1 counter." },
  { name: "Undying", category: "Keyword", text: "When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield with a +1/+1 counter." },
  { name: "Storm", category: "Keyword", text: "When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies." },
  { name: "Suspend", category: "Keyword", text: "Exile this card with time counters, remove one at the start of each of your upkeeps, then cast it for free when the last is removed." },
  { name: "Exalted", category: "Keyword", text: "Whenever a creature you control attacks alone, it gets +1/+1 until end of turn for each instance of exalted." },
  { name: "Delve", category: "Keyword", text: "Each card you exile from your graveyard as you cast this spell pays for {1}." },
  { name: "Dredge", category: "Keyword", text: "If you would draw a card, you may instead mill that many cards and return this card from your graveyard to your hand." },
  { name: "Extort", category: "Keyword", text: "Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life." },
  { name: "Ninjutsu", category: "Keyword", text: "Return an unblocked attacker you control to hand, then put this card onto the battlefield tapped and attacking." },
  { name: "Escape", category: "Keyword", text: "You may cast this card from your graveyard for its escape cost, which includes exiling cards from your graveyard." },
  { name: "Foretell", category: "Keyword", text: "During your turn, pay {2} to exile this card face down. Cast it later for its foretell cost." },
  { name: "Blitz", category: "Keyword", text: "Cast this creature for its blitz cost. It gains haste and \"When this dies, draw a card,\" and is sacrificed at the next end step." },
  { name: "Casualty", category: "Keyword", text: "As you cast this spell, you may sacrifice a creature with the stated power or greater to copy the spell." },
  { name: "Adventure", category: "Keyword", text: "You may cast the adventure (an instant or sorcery) first, then exile the card to cast the creature later." },
  { name: "Riot", category: "Keyword", text: "This creature enters the battlefield with your choice of a +1/+1 counter or haste." },
  { name: "Rebound", category: "Keyword", text: "If you cast this from your hand, exile it as it resolves. On your next upkeep you may cast it from exile without paying its cost." },
  { name: "Phasing", category: "Keyword", text: "A phased-out permanent is treated as though it doesn't exist. It phases in during its controller's untap step." },
  { name: "Scry", category: "Action", text: "Look at the top N cards of your library, then put any number of them on the bottom and the rest back on top in any order." },
  { name: "Surveil", category: "Action", text: "Look at the top N cards of your library, then put any number of them into your graveyard and the rest back on top in any order." },
  { name: "Fight", category: "Action", text: "Two creatures each deal damage equal to their power to the other." },
  { name: "Mill", category: "Action", text: "Put the top N cards of a library into its owner's graveyard." },
  { name: "Proliferate", category: "Action", text: "For each permanent and player that has a counter on it, you may give it another counter of a kind already there." },
  { name: "Populate", category: "Action", text: "Create a token that's a copy of a creature token you control." },
  { name: "Explore", category: "Action", text: "Reveal the top card of your library. If it's a land, put it into your hand; otherwise put a +1/+1 counter on this creature and choose whether to keep the card on top or in your graveyard." },
  { name: "Connive", category: "Action", text: "Draw N cards, then discard N cards. Put a +1/+1 counter on this creature for each nonland card discarded this way." },
  { name: "Regenerate", category: "Action", text: "The next time this permanent would be destroyed this turn, instead tap it, remove it from combat, and remove all damage from it." },
  { name: "Amass", category: "Action", text: "Put N +1/+1 counters on an Army you control, or create a 0/0 black Army creature token first if you have none." },
]

/** Keywords whose name matches first, then ones whose explanation mentions [query]. */
export function searchKeywords(query: string): Keyword[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return KEYWORDS
  const byName = KEYWORDS.filter((k) => k.name.toLowerCase().includes(needle))
  const byText = KEYWORDS.filter((k) => k.text.toLowerCase().includes(needle) && !byName.includes(k))
  return [...byName, ...byText]
}
